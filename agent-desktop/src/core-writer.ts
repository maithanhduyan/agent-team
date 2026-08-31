/**
 * L3 writer — `memory/core.md` (spec §6).
 *
 * Contract implemented here:
 * - `core.md` is a curated Markdown document: YAML front-matter header
 *   (§6.1) followed by one fact block per fact, delimited by
 *   `<!-- fact_NNNN -->` markers and `## fact_NNNN: <title>` headings,
 *   with `- **key:** value` metadata lines (§6.2).
 * - **R-CORE-1:** `core.md` is written ONLY by the consolidation job.
 *   This writer enforces it at the API level: every mutating call
 *   requires a consolidation run context carrying a `cons_<uuid>` id.
 *   A live turn / tool cannot construct that context.
 * - R-CORE-3: superseding never edits a fact in place — the old block
 *   gets `valid_to` set + `status: superseded` and a new block is
 *   appended (§9.3/§10.3). The `supersede` L2 record is the
 *   consolidation job's responsibility (T05).
 * - Every fact block is validated against §6.2 before writing; missing
 *   required keys are a write/parse error (spec §13, §6.2).
 * - Fact ids are a monotonic counter per file: `fact_<n>` (spec §4.2).
 * - Appends take an exclusive lock (`.core.lock`, `wx` mode) around the
 *   read-modify-write to avoid torn writes (REQUIREMENTS.md §5 gap 3).
 */

import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateFactBlockMetadata } from './schema.js';
import type { CoreMdDocument, FactBlock, FactStatus, ISOTimestamp } from './types.js';

/** Thrown when a non-consolidation caller attempts to write L3 (R-CORE-1). */
export class ConsolidationOnlyError extends Error {
    constructor(detail = '') {
        super(`R-CORE-1: core.md is written only by the consolidation job${detail ? ` (${detail})` : ''}`);
        this.name = 'ConsolidationOnlyError';
    }
}

/** Thrown when a fact block fails §6.2 validation or parsing. */
export class FactBlockError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FactBlockError';
    }
}

/** Consolidation run context required for any L3 write (R-CORE-1). */
export interface ConsolidationContext {
    /** `cons_<uuid>` (spec §4.2). */
    runId: string;
}

function isConsolidationContext(ctx: unknown): ctx is ConsolidationContext {
    return typeof ctx === 'object' && ctx !== null &&
        typeof (ctx as ConsolidationContext).runId === 'string' &&
        /^cons_[0-9a-fA-F-]{8,}$/.test((ctx as ConsolidationContext).runId);
}

export interface CoreWriterOptions {
    /** Clock for header `updated` / `last_observed` defaults; injectable for tests. */
    now?: () => Date;
    /** Logger for warnings. Default: console. */
    log?: Pick<Console, 'warn' | 'info'>;
}

const FACT_ID_RE = /^fact_(\d+)$/;

/** Format a fact id with zero-padded counter: `fact_0012` (spec §4.2). */
export function formatFactId(n: number): string {
    return `fact_${String(n).padStart(4, '0')}`;
}

/** Parse the next monotonic fact counter from an existing document. */
export function nextFactNumber(facts: readonly FactBlock[]): number {
    let max = 0;
    for (const fact of facts) {
        const m = FACT_ID_RE.exec(fact.id);
        if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
}

export class CoreWriter {
    readonly dir: string;
    readonly file: string;
    private readonly opts: CoreWriterOptions;
    private readonly lockFile: string;

    constructor(memoryDir: string, overrides?: CoreWriterOptions) {
        this.dir = memoryDir;
        this.file = path.join(memoryDir, 'core.md');
        this.lockFile = path.join(memoryDir, '.core.lock');
        this.opts = {
            now: () => new Date(),
            log: console,
            ...overrides,
        };
    }

    /** Read and parse `core.md`. Returns the header + fact blocks. */
    async read(): Promise<CoreMdDocument> {
        let content: string;
        try {
            content = await readFile(this.file, 'utf8');
        } catch {
            return { header: { memory_version: 1, updated: toIso(this.opts.now!()), count: 0 }, facts: [] };
        }
        return parseCoreMd(content);
    }

    /**
     * Append a new fact block (consolidation only, R-CORE-1). Takes an
     * exclusive lock, re-reads the file, validates the block, assigns
     * the next monotonic `fact_<n>` id, and writes the updated document
     * atomically (temp file + rename).
     */
    async appendFact(ctx: ConsolidationContext, input: NewFactBlock): Promise<FactBlock> {
        this.assertConsolidation(ctx);
        await this.ensureDir();
        return this.withLock(async () => {
            const doc = await this.read();
            const block = this.buildBlock(doc, input);
            await this.writeDoc(doc, block);
            return block;
        });
    }

    /**
     * Supersede an existing active fact (R-CORE-3, consolidation only):
     * the old block gets `valid_to` + `status: superseded`, and a new
     * block with the replacement content is appended. Returns both
     * blocks. (The corresponding `supersede` L2 record is written by
     * the consolidation job — T05.)
     */
    async supersedeFact(
        ctx: ConsolidationContext,
        oldId: string,
        replacement: NewFactBlock,
        validTo: ISOTimestamp,
    ): Promise<{ superseded: FactBlock; created: FactBlock }> {
        this.assertConsolidation(ctx);
        await this.ensureDir();
        return this.withLock(async () => {
            const doc = await this.read();
            const target = doc.facts.find((f) => f.id === oldId);
            if (!target) {
                throw new FactBlockError(`cannot supersede: fact "${oldId}" not found in core.md`);
            }
            if (target.status !== 'active') {
                throw new FactBlockError(`cannot supersede: fact "${oldId}" is not active (status=${target.status})`);
            }
            const superseded: FactBlock = { ...target, valid_to: validTo, status: 'superseded' };
            const created = this.buildBlock(doc, replacement);
            const updatedFacts = doc.facts.map((f) => f.id === oldId ? superseded : f);
            const newDoc: CoreMdDocument = { header: doc.header, facts: [...updatedFacts, created] };
            await this.writeRawDoc(newDoc);
            return { superseded, created };
        });
    }

    /**
     * Update the status/validity/importance of an existing fact in place
     * (consolidation only — decay/expiry/stale transitions, §10.4, and
     * the T05 decay pass which also halves `importance` and clears `hot`
     * on demotion; ADR-013).
     */
    async updateStatus(
        ctx: ConsolidationContext,
        factId: string,
        patch: {
            status?: FactStatus;
            valid_to?: ISOTimestamp | null;
            importance?: number;
            hot?: boolean;
        },
    ): Promise<FactBlock> {
        this.assertConsolidation(ctx);
        await this.ensureDir();
        return this.withLock(async () => {
            const doc = await this.read();
            const target = doc.facts.find((f) => f.id === factId);
            if (!target) {
                throw new FactBlockError(`cannot update: fact "${factId}" not found in core.md`);
            }
            const updated: FactBlock = { ...target, ...patch };
            const newDoc: CoreMdDocument = {
                header: doc.header,
                facts: doc.facts.map((f) => f.id === factId ? updated : f),
            };
            await this.writeRawDoc(newDoc);
            return updated;
        });
    }

    /** Assert the caller carries a valid consolidation context (R-CORE-1). */
    private assertConsolidation(ctx: ConsolidationContext): void {
        if (!isConsolidationContext(ctx)) {
            throw new ConsolidationOnlyError('missing or invalid consolidation run context (cons_<uuid> required)');
        }
    }

    private async ensureDir(): Promise<void> {
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
    }

    /** Build a validated FactBlock with the next id and defaults. */
    private buildBlock(doc: CoreMdDocument, input: NewFactBlock): FactBlock {
        const id = formatFactId(nextFactNumber(doc.facts));
        const nowIso = toIso(this.opts.now!());
        const block: FactBlock = {
            id,
            title: input.title ?? input.statement.slice(0, 60),
            statement: input.statement,
            provenance: input.provenance,
            importance: input.importance ?? 0.5,
            hot: input.hot ?? false,
            valid_from: input.valid_from ?? nowIso,
            valid_to: input.valid_to ?? null,
            source: input.source,
            supporting_observations: (input.supporting_observations ?? []).join(', '),
            observation_count: input.observation_count ?? 0,
            last_observed: input.last_observed ?? nowIso,
            status: 'active',
        };
        validateFactBlock(block);
        return block;
    }

    /** Read-modify-write with an exclusive lock. */
    private async withLock<T>(fn: () => Promise<T>): Promise<T> {
        const lock = await open(this.lockFile, 'wx').catch(() => null);
        if (!lock) {
            throw new FactBlockError(`core.md is locked by another writer (${this.lockFile} exists)`);
        }
        try {
            return await fn();
        } finally {
            await lock.close().catch(() => undefined);
            // Best-effort removal of the lock file.
            await import('node:fs/promises').then((m) => m.unlink(this.lockFile)).catch(() => undefined);
        }
    }

    /** Write doc + appended block: update header, serialize, atomic rename. */
    private async writeDoc(doc: CoreMdDocument, appended: FactBlock): Promise<void> {
        const newDoc: CoreMdDocument = {
            header: {
                memory_version: 1,
                updated: toIso(this.opts.now!()),
                count: doc.facts.length + 1,
            },
            facts: [...doc.facts, appended],
        };
        await this.writeRawDoc(newDoc);
    }

    private async writeRawDoc(doc: CoreMdDocument): Promise<void> {
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, serializeCoreMd(doc), 'utf8');
        await rename(tmp, this.file);
    }
}

/** A new fact block before id assignment (id/title/status defaulted by the writer). */
export interface NewFactBlock {
    statement: string;
    provenance: FactBlock['provenance'];
    importance?: number;
    hot?: boolean;
    valid_from?: ISOTimestamp;
    valid_to?: ISOTimestamp | null;
    source: string;
    supporting_observations?: string[];
    observation_count?: number;
    last_observed?: ISOTimestamp;
    title?: string;
}

function toIso(date: Date): string {
    return date.toISOString();
}

/** Validate a fully-built fact block against §6.2 (throws FactBlockError). */
export function validateFactBlock(block: FactBlock): void {
    if (!FACT_ID_RE.test(block.id)) {
        throw new FactBlockError(`invalid fact id "${block.id}" (expected fact_<n>)`);
    }
    if (typeof block.statement !== 'string' || block.statement.trim() === '') {
        throw new FactBlockError('fact block missing required key: statement (§6.2)');
    }
    const meta: Record<string, unknown> = {
        statement: block.statement,
        provenance: block.provenance,
        importance: block.importance,
        hot: block.hot,
        valid_from: block.valid_from,
        valid_to: block.valid_to ?? '',
        source: block.source,
        supporting_observations: block.supporting_observations,
        observation_count: block.observation_count,
        last_observed: block.last_observed,
        status: block.status,
    };
    const result = validateFactBlockMetadata(meta);
    if (!result.ok) {
        throw new FactBlockError(`invalid fact block: ${result.errors.join('; ')}`);
    }
}

/* ------------------------------------------------------------------ */
/* Serialization / parsing of core.md                                  */
/* ------------------------------------------------------------------ */

/** Serialize a document to the core.md format (spec §6.1/§6.2). */
export function serializeCoreMd(doc: CoreMdDocument): string {
    const lines: string[] = [];
    lines.push('---');
    lines.push(`memory_version: ${doc.header.memory_version}`);
    lines.push(`updated: ${doc.header.updated}`);
    lines.push(`count: ${doc.header.count}`);
    lines.push('---');
    lines.push('');
    lines.push('# Core Memory');
    lines.push('');
    for (const fact of doc.facts) {
        lines.push(`<!-- ${fact.id} -->`);
        lines.push(`## ${fact.id}: ${fact.title}`);
        lines.push('');
        lines.push(`- **statement:** ${fact.statement}`);
        lines.push(`- **provenance:** ${fact.provenance}`);
        lines.push(`- **importance:** ${fact.importance}`);
        lines.push(`- **hot:** ${fact.hot}`);
        lines.push(`- **valid_from:** ${fact.valid_from}`);
        lines.push(`- **valid_to:** ${fact.valid_to ?? '(empty = open)'}`);
        lines.push(`- **source:** ${fact.source}`);
        lines.push(`- **supporting_observations:** ${fact.supporting_observations}`);
        lines.push(`- **observation_count:** ${fact.observation_count}`);
        lines.push(`- **last_observed:** ${fact.last_observed}`);
        lines.push(`- **status:** ${fact.status}`);
        lines.push('');
    }
    return lines.join('\n');
}

/**
 * Parse `core.md` content into a document.
 *
 * Strict per spec §6.2 / §13 row 4: a malformed fact block — an id that
 * is not `fact_<n>` (spec §4.2) or a block missing a required key —
 * raises `FactBlockError` instead of being silently skipped. Silent
 * data loss (a file parsing to 0 facts with no error) is an
 * availability concern (spec §11) and must never happen.
 */
export function parseCoreMd(content: string): CoreMdDocument {
    const lines = content.split(/\r?\n/);

    // YAML front matter header (spec §6.1).
    let header: CoreMdDocument['header'] | null = null;
    if (lines[0]?.trim() === '---') {
        const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
        if (end !== -1) {
            const yaml = lines.slice(1, end);
            const get = (key: string): string | undefined => {
                const line = yaml.find((l) => l.startsWith(`${key}:`));
                return line?.slice(key.length + 1).trim();
            };
            header = {
                memory_version: Number(get('memory_version') ?? 1),
                updated: get('updated') ?? toIso(new Date()),
                count: Number(get('count') ?? 0),
            };
            lines.splice(0, end + 1);
        }
    }

    const facts: FactBlock[] = [];
    let currentId: string | null = null;
    let currentTitle = '';
    let meta: Record<string, unknown> = {};

    const flush = (): void => {
        if (currentId === null) return;
        const result = validateFactBlockMetadata(meta);
        if (!result.ok) {
            throw new FactBlockError(`fact ${currentId}: ${result.errors.join('; ')}`);
        }
        facts.push({
            id: currentId,
            title: currentTitle || currentId,
            statement: String(meta.statement ?? ''),
            provenance: meta.provenance as FactBlock['provenance'],
            importance: Number(meta.importance ?? 0),
            hot: meta.hot === true,
            valid_from: String(meta.valid_from ?? ''),
            valid_to: meta.valid_to === '' || meta.valid_to === undefined ? null : String(meta.valid_to),
            source: String(meta.source ?? ''),
            supporting_observations: String(meta.supporting_observations ?? ''),
            observation_count: Number(meta.observation_count ?? 0),
            last_observed: String(meta.last_observed ?? ''),
            status: meta.status as FactBlock['status'],
        });
        currentId = null;
        meta = {};
    };

    for (const raw of lines) {
        const line = raw.trim();

        // A fact-block marker is any `<!-- fact_... -->` comment (§6.2);
        // the id must be `fact_<n>` (spec §4.2). A marker with a
        // malformed id is a parse error — never a silent skip (§13 row 4).
        const marker = /^<!--\s*(.+?)\s*-->$/.exec(line);
        if (marker && marker[1].startsWith('fact_')) {
            flush();
            const id = marker[1].trim();
            if (!FACT_ID_RE.test(id)) {
                throw new FactBlockError(`parse error: invalid fact id "${id}" (expected fact_<n>, §4.2/§6.2)`);
            }
            currentId = id;
            currentTitle = '';
            continue;
        }

        // A fact-block heading `## fact_...: title` (a bare `## fact_...`
        // heading is also a block opener). The id is validated the same
        // way — malformed ids raise instead of being dropped.
        const heading = /^##\s*(fact_[^\s:]+)\s*:?\s*(.*)$/.exec(line);
        if (heading) {
            const id = heading[1];
            if (!FACT_ID_RE.test(id)) {
                throw new FactBlockError(`parse error: invalid fact id "${id}" (expected fact_<n>, §4.2/§6.2)`);
            }
            // The heading titles the block opened by the marker above; it
            // does not start a new block, so no flush here.
            if (currentId === null) {
                flush();
                currentId = id;
            }
            currentTitle = heading[2].trim();
            continue;
        }

        const kv = /^-\s*\*\*([a-z_]+):\*\*\s*(.*)$/.exec(line);
        if (kv && currentId !== null) {
            meta[kv[1]] = parseMetaValue(kv[1], kv[2]);
        }
    }
    flush();

    if (!header) {
        header = { memory_version: 1, updated: toIso(new Date()), count: facts.length };
    }
    return { header, facts };
}

/** Parse a `- **key:** value` metadata value with light typing (spec §6.2). */
function parseMetaValue(key: string, value: string): unknown {
    if (key === 'importance') return Number(value);
    if (key === 'observation_count') return Number(value);
    if (key === 'hot') return value === 'true';
    if (key === 'valid_to') return value === '(empty = open)' || value === '' ? '' : value;
    if (key === 'supporting_observations') return value;
    return value;
}
