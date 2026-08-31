/**
 * L2 append-only writer — `memory/sessions.jsonl` (spec §5).
 *
 * Contract implemented here:
 * - JSONL, `\n`-terminated, append-only with `O_APPEND` semantics
 *   (spec §5.1). The full line is written in one call; on failure the
 *   partial tail is truncated back to the pre-write size, so a failed
 *   write never corrupts prior lines.
 * - Every line is schema-validated (§5.2–§5.3) before being written;
 *   schema-invalid records are rejected and an `error` audit record is
 *   appended instead (spec §13: "a quarantine/error record is written").
 * - Mandatory provenance (R-PROV-1, §4.3/§10.1): a record without a
 *   valid provenance tag is rejected.
 * - Source-gated writes (§10.2.1): a record without a verifiable
 *   `source` is rejected and a `quarantine` record is written.
 * - Injection-pattern quarantine (§10.2.2): text matching
 *   `MEMORY_INJECTION_PATTERNS` is quarantined — a `quarantine` record
 *   is written and the original content never reaches L3/L4.
 * - Rotation (§5.5): when `sessions.jsonl` exceeds `MEMORY_ROTATE_MB`
 *   it is rotated into `sessions-YYYYMMDD.jsonl`; reading searches the
 *   current file plus all archives so rotation is transparent.
 * - A corrupted tail line never breaks reads: reads skip invalid lines
 *   and report them (spec §11 availability).
 */

import { mkdir, open, rename, readdir, readFile, stat, truncate } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { validateL2Record } from './schema.js';
import { DEFAULT_INJECTION_PATTERNS, scanForInjection } from './injection.js';
import { PROVENANCE_VALUES, type L2Record, type L2RecordType } from './types.js';

/** Result of an `append` call. */
export type AppendResult =
    | { status: 'written'; record: L2Record }
    | { status: 'quarantined'; quarantine: L2Record; reason: string; pattern?: string }
    | { status: 'rejected'; errors: string[]; audit: L2Record };

export interface SessionsWriterOptions {
    /** Rotation threshold in bytes (default: from `MEMORY_ROTATE_MB`, 100 MB). */
    rotateBytes: number;
    /** Injection patterns; defaults shipped in `injection.ts`. */
    injectionPatterns: string[];
    /** Clock for `ts`/`valid_from` defaults; injectable for tests. */
    now?: () => Date;
    /** Logger for warnings (corrupt lines, rotation). Default: console. */
    log?: Pick<Console, 'warn' | 'info'>;
}

/** ISO 8601 UTC with ms precision and `Z` suffix (spec §4.2). */
export function toIsoUtc(date: Date): string {
    return date.toISOString();
}

const WRITER_SOURCE = { kind: 'tool', ref: 'memory:writer', detail: 'memory core module writer (T03)' } as const;

/** Extract a text representation of a raw record for quarantine content. */
function rawText(input: unknown): string {
    if (typeof input === 'string') return input;
    if (typeof input !== 'object' || input === null) return String(input ?? '');
    const content = (input as Record<string, unknown>).content;
    if (typeof content === 'string') return content;
    if (content !== undefined && content !== null) {
        return JSON.stringify(content);
    }
    return JSON.stringify(input);
}

function defaultOptions(overrides?: Partial<SessionsWriterOptions>): SessionsWriterOptions {
    const rotateMb = Number(process.env.MEMORY_ROTATE_MB ?? 100);
    return {
        rotateBytes: Math.round((Number.isFinite(rotateMb) && rotateMb > 0 ? rotateMb : 100) * 1024 * 1024),
        injectionPatterns: [...DEFAULT_INJECTION_PATTERNS],
        now: () => new Date(),
        log: console,
        ...overrides,
    };
}

export class SessionsWriter {
    readonly dir: string;
    readonly file: string;
    private readonly opts: SessionsWriterOptions;

    constructor(memoryDir: string, overrides?: Partial<SessionsWriterOptions>) {
        this.dir = memoryDir;
        this.file = path.join(memoryDir, 'sessions.jsonl');
        this.opts = defaultOptions(overrides);
    }

    /** Ensure the memory directory exists with 0700 permissions (spec §11). */
    private async ensureDir(): Promise<void> {
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
    }

    /** Appended `sessions-YYYYMMDD.jsonl` archive name for a date (spec §5.5). */
    private archiveName(date: Date): string {
        const yyyy = date.getUTCFullYear();
        const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(date.getUTCDate()).padStart(2, '0');
        return `sessions-${yyyy}${mm}${dd}.jsonl`;
    }

    /** List archive files in the memory dir (spec §5.5 — one per day). */
    async listArchives(): Promise<string[]> {
        let entries: string[];
        try {
            entries = await readdir(this.dir);
        } catch {
            return [];
        }
        return entries
            .filter((name) => /^sessions-\d{8}\.jsonl$/.test(name))
            .sort();
    }

    /** Current size of `sessions.jsonl` in bytes (0 if absent). */
    async sizeBytes(): Promise<number> {
        try {
            const s = await stat(this.file);
            return s.size;
        } catch {
            return 0;
        }
    }

    /**
     * Append one record. Validates, then writes a single JSONL line with
     * O_APPEND semantics. On validation failure the record is rejected
     * (nothing written for it) and an audit `error`/`quarantine` record
     * is appended. Returns the outcome.
     */
    async append(input: unknown): Promise<AppendResult> {
        await this.ensureDir();

        // Normalize defaults (id/ts/importance/valid_from/session_id) —
        // the schema's mandatory fields remain mandatory after this step.
        const normalized = this.normalize(input);

        // Source-gated write (§10.2.1): a record without a verifiable
        // origin is quarantined regardless of other fields.
        if (!this.hasVerifiableSource(normalized)) {
            const quarantine = this.quarantineRawRecord('no_source', normalized);
            await this.appendLine(quarantine);
            await this.maybeRotate();
            return { status: 'quarantined', quarantine, reason: 'no_source' };
        }

        const validation = validateL2Record(normalized);
        if (!validation.ok || !validation.record) {
            // R-PROV-1 (spec §4.3 / §10.1, §13 row 1): a write rejected
            // because the record has no valid provenance tag is audited
            // with the dedicated `provenance_missing` code (fixture
            // write-attempts att-1 pins `code: "provenance_missing"`,
            // message "write rejected: provenance is mandatory") — not the
            // generic `schema_invalid` (Redmine #42 / F1′).
            const provenanceMissing = this.hasMissingProvenance(normalized);
            const audit = this.auditRecord(
                'error',
                provenanceMissing
                    ? { code: 'provenance_missing', message: 'write rejected: provenance is mandatory' }
                    : { code: 'schema_invalid', message: validation.errors.join('; ') },
                provenanceMissing
                    ? 'rejected record: provenance is mandatory (R-PROV-1, spec §4.3/§10.1)'
                    : 'rejected record that failed schema validation',
            );
            await this.appendLine(audit);
            await this.maybeRotate();
            return { status: 'rejected', errors: validation.errors, audit };
        }

        const record = validation.record;

        // Injection-pattern quarantine (§10.2.2).
        const scan = scanForInjection(record, this.opts.injectionPatterns);
        if (scan.matched) {
            const quarantine = this.quarantineRecord('injection_pattern', record, scan.pattern ?? undefined);
            await this.appendLine(quarantine);
            await this.maybeRotate();
            return { status: 'quarantined', quarantine, reason: 'injection_pattern', pattern: scan.pattern ?? undefined };
        }

        await this.appendLine(record);
        await this.maybeRotate();
        return { status: 'written', record };
    }

    /** Fill defaults for optional fields before validation. */
    private normalize(input: unknown): unknown {
        if (typeof input !== 'object' || input === null || Array.isArray(input)) {
            return input;
        }
        const rec = input as Record<string, unknown>;
        const nowIso = toIsoUtc(this.opts.now!());
        const out: Record<string, unknown> = { ...rec };
        if (out.id === undefined) out.id = `evt_${randomUUID()}`;
        if (out.ts === undefined) out.ts = nowIso;
        if (out.session_id === undefined) out.session_id = null;
        if (out.importance === undefined) out.importance = 0.5;
        if (out.valid_from === undefined) out.valid_from = nowIso;
        if (out.valid_to === undefined) out.valid_to = null;
        return out;
    }

    private hasVerifiableSource(input: unknown): boolean {
        if (typeof input !== 'object' || input === null || Array.isArray(input)) {
            return false;
        }
        const source = (input as Record<string, unknown>).source;
        if (typeof source !== 'object' || source === null) {
            return false;
        }
        const kind = (source as Record<string, unknown>).kind;
        return kind === 'user' || kind === 'tool' || kind === 'model' || kind === 'bridge';
    }

    /**
     * True when a record was rejected because it carries no valid
     * provenance tag (R-PROV-1, spec §4.3 / §10.1): `provenance` missing
     * or not one of `user_stated | model_inferred | tool_output`. Used to
     * pick the dedicated audit `content.code = "provenance_missing"` over
     * the generic `schema_invalid` (spec §13 row 1, fixture att-1).
     */
    private hasMissingProvenance(input: unknown): boolean {
        if (typeof input !== 'object' || input === null || Array.isArray(input)) {
            return false; // not even a record — generic schema failure
        }
        return !PROVENANCE_VALUES.includes((input as Record<string, unknown>).provenance as L2Record['provenance']);
    }

    /** Build a writer-generated audit record (error or quarantine). */
    private auditRecord(
        type: L2RecordType,
        content: Record<string, unknown>,
        detail: string,
    ): L2Record {
        const nowIso = toIsoUtc(this.opts.now!());
        return {
            id: `evt_${randomUUID()}`,
            ts: nowIso,
            session_id: null,
            type,
            provenance: 'tool_output',
            importance: 0.5,
            valid_from: nowIso,
            valid_to: null,
            content: content as L2Record['content'],
            source: { ...WRITER_SOURCE, detail },
        };
    }

    private quarantineRecord(
        reason: 'injection_pattern' | 'no_source' | 'conflict',
        offending: L2Record,
        pattern: string | undefined,
    ): L2Record {
        return this.quarantineRawRecord(reason, offending, pattern);
    }

    /** Build a quarantine audit record from a raw (possibly invalid) input. */
    private quarantineRawRecord(
        reason: 'injection_pattern' | 'no_source' | 'conflict',
        offending: unknown,
        pattern?: string,
    ): L2Record {
        const text = rawText(offending);
        const content: Record<string, unknown> = {
            reason,
            text: text.slice(0, 500),
            snippet: pattern ?? text.slice(0, 200),
        };
        return this.auditRecord('quarantine', content, `quarantined record (${reason})`);
    }

    /** Append one line with O_APPEND; truncate the partial tail on failure (§5.1). */
    private async appendLine(record: L2Record): Promise<void> {
        const line = JSON.stringify(record) + '\n';
        let priorSize = 0;
        try {
            const s = await stat(this.file);
            priorSize = s.size;
        } catch {
            priorSize = 0; // new file
        }

        const fd = await open(this.file, 'a'); // O_APPEND | O_CREAT
        try {
            await fd.write(line);
        } catch (err) {
            // Truncate any partial tail so prior lines are never corrupted.
            try {
                const rw = await open(this.file, 'r+');
                try {
                    await rw.truncate(priorSize);
                } finally {
                    await rw.close();
                }
            } catch {
                // Best effort; the original write error is the real failure.
            }
            throw err;
        } finally {
            await fd.close();
        }
    }

    /**
     * Rotate `sessions.jsonl` when it exceeds `rotateBytes` (spec §5.5):
     * move its content into the day's archive, then start a fresh file.
     * If the day's archive already exists its content is preserved
     * (append + truncate) so one archive per day holds all rotations.
     * (On POSIX `rename` would silently overwrite an existing archive,
     * so existence is checked first.)
     */
    async maybeRotate(): Promise<boolean> {
        const size = await this.sizeBytes();
        if (size < this.opts.rotateBytes) {
            return false;
        }
        return this.rotate();
    }

    /** Force a rotation regardless of size (used by tests / operators). */
    async rotate(): Promise<boolean> {
        if (await this.sizeBytes() === 0) return false;
        const archive = path.join(this.dir, this.archiveName(this.opts.now!()));
        let archiveExists = false;
        try {
            await stat(archive);
            archiveExists = true;
        } catch {
            archiveExists = false;
        }
        if (!archiveExists) {
            await rename(this.file, archive);
        } else {
            // Archive already exists: append current content, then truncate.
            const data = await readFile(this.file);
            const afd = await open(archive, 'a');
            try {
                if (data.length > 0) await afd.write(data);
            } finally {
                await afd.close();
            }
            await truncate(this.file, 0);
        }
        this.opts.log?.info?.(`[memory] rotated sessions.jsonl -> ${path.basename(archive)}`);
        return true;
    }

    /**
     * Read all records from the current file plus all archives, in
     * chronological file order (archives first, oldest to newest, then
     * the current file). Corrupted lines are skipped and reported
     * (spec §11 availability). Rotation is transparent to readers.
     */
    async readAll(): Promise<{ records: L2Record[]; skipped: string[] }> {
        await this.ensureDir();
        const archives = await this.listArchives();
        const files = [...archives, 'sessions.jsonl'];
        const records: L2Record[] = [];
        const skipped: string[] = [];

        for (const name of files) {
            const filePath = path.join(this.dir, name);
            let content: string;
            try {
                content = await readFile(filePath, 'utf8');
            } catch {
                continue; // missing current file / unreadable archive
            }
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.trim() === '') continue;
                try {
                    const parsed = JSON.parse(line) as unknown;
                    const validation = validateL2Record(parsed);
                    if (validation.ok && validation.record) {
                        records.push(validation.record);
                    } else {
                        skipped.push(`${name}:${i + 1}: schema-invalid (${validation.errors.join('; ')})`);
                    }
                } catch {
                    skipped.push(`${name}:${i + 1}: not valid JSON`);
                }
            }
        }

        if (skipped.length > 0) {
            this.opts.log?.warn?.(`[memory] skipped ${skipped.length} corrupt/invalid line(s) while reading sessions.jsonl`);
        }
        return { records, skipped };
    }
}
