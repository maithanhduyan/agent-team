/**
 * Consolidation job — sleep-time compute (spec §8, ADR-006/013).
 *
 * Pipeline (spec §8.2): extract & group → reflect (`{context, error,
 * fix}`, §8.3) → candidate → graduation rule (N=3–5 distinct
 * observations, §8.4) → judge gate (§9) → verifier (§10.5) → write
 * L3/L4.
 *
 * Also implements the guardrails:
 * - **§8.1 lifecycle:** runs out-of-session (session end + idle, or on
 *   `MEMORY_CONSOLIDATE_EVERY_MIN`); idempotent/resumable via a cursor
 *   (`memory/consolidation-cursor.json`) that survives rotation; every
 *   run writes a `cons_<uuid>` run record (type `consolidation` —
 *   ADR-013; `error` on failure per §8.1).
 * - **§10.3 anti-conflict:** a candidate that contradicts an active fact
 *   goes through the judge-approved **supersede** flow — old block gets
 *   `valid_to` + `status: superseded`, a new block is appended, a
 *   `supersede` L2 record links old→new; never an in-place overwrite.
 * - **§10.4 decay/anti-drift (Day-30):** active facts not re-observed
 *   for `MEMORY_DECAY_DAYS` have importance halved (floor 0.1), `decay`
 *   records written, hot facts demoted (`hot_demote`), and stale at 2
 *   cycles (~60 days). Decay is derived from L2 `decay` records so it is
 *   idempotent across runs; nothing is deleted (R-MEM-5).
 * - **§10.5 verifier:** deterministic citation / provenance-chain /
 *   conflict / injection re-scan before any L3/L4 write.
 *
 * The exposed helpers (`runConsolidation`, `applyConflict`, `applyDecay`,
 * `judge`, `reflect`, `validateVerdict`, `resolvePanel`) are the T06
 * adapter surface (agent-desktop/tests/lib/adapters.mjs).
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { MemoryConfigError, parseGraduationN } from './config.js';
import { CoreWriter, type ConsolidationContext, type NewFactBlock } from './core-writer.js';
import { SessionsWriter, toIsoUtc } from './sessions-writer.js';
import { reflect } from './reflect.js';
import { judgeGate, resolvePanel } from './judge.js';
import type { CandidateInput, FactLike, JudgeConfig, JudgeGateInput, JudgeGateResult } from './judge.js';
import { findConflictingFacts, verifyCandidate } from './verifier.js';
import { buildPanelFromConfig, type LLMProvider as PanelProvider } from './llm-provider.js';
import type { JudgeModelName } from './llm-provider.js';
import type { FactBlock, FactStatus, ISOTimestamp, L2Record } from './types.js';

export {
    judgeGate,
    validateVerdict,
    parseVerdictText,
    buildJudgePrompt,
    resolvePanel,
    type JudgeGateResult,
    type JudgeVerdict,
    type CandidateInput,
    type FactLike,
    type VerdictValue,
} from './judge.js';

/**
 * T06-adapter-compatible `judge` entry point. Accepts BOTH the native
 * single-input shape `judge({candidate, providers, consensus, cfg, ...})`
 * and the T06 harness shape `judge({candidate}, {providers, consensus}, cfg)`
 * (see agent-desktop/tests/lib/adapters.mjs). Behavior is `judgeGate`.
 */
export async function judge(
    input: JudgeGateInput | { candidate: CandidateInput },
    opts: {
        providers?: Record<string, PanelProvider> | PanelProvider[];
        consensus?: 'any' | 'majority';
        cfg?: JudgeConfig;
    } = {},
    cfgRaw?: JudgeConfig,
): Promise<JudgeGateResult> {
    const native = input as JudgeGateInput;
    return judgeGate({
        candidate: (input as { candidate: CandidateInput }).candidate,
        supporting: native.supporting,
        activeFacts: native.activeFacts,
        providers: native.providers ?? opts.providers ?? {},
        consensus: native.consensus ?? opts.consensus,
        cfg: native.cfg ?? opts.cfg ?? cfgRaw,
        cost: native.cost,
        log: native.log,
    });
}

export {
    reflect,
    validateReflection,
    parseReflectionText,
    buildReflectPrompt,
    ReflectionError,
    type ReflectionLesson,
} from './reflect.js';

export { findConflictingFacts, verifyCandidate, statementOverlap } from './verifier.js';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

/** Build writer options with only the values that are defined (a bare
 * `{ now: undefined }` would override the writers' defaults). */
function writerOptions(
    now: (() => Date) | undefined,
    log: Pick<Console, 'warn' | 'info' | 'debug' | 'error'> | undefined,
): { now?: () => Date; log?: Pick<Console, 'warn' | 'info'> } {
    const out: { now?: () => Date; log?: Pick<Console, 'warn' | 'info'> } = {};
    if (now) out.now = now;
    if (log) out.log = log;
    return out;
}

/** Normalized consolidation config (accepts MemoryConfig OR raw env-like record). */
export interface ConsolidationConfig {
    graduationN: number;
    decayDays: number;
    hotImportance: number;
    verifyMinOverlap: number;
    conflictOverlap: number;
    judgePanelModels: string[];
    judgeConsensus: 'any' | 'majority';
    judgeMaxModelsPerCall: number;
    judgeTimeoutS: number;
    judgeCaps: Partial<Record<JudgeModelName, number>>;
    /** Test anchor "now"; default real now. */
    refNow?: ISOTimestamp;
}

/** Raw config input: env-style keys (`MEMORY_GRADUATION_N`) and/or MemoryConfig fields. */
export type ConsolidationConfigInput =
    | Partial<ConsolidationConfig>
    | Record<string, unknown>;

const DAY_MS = 86_400_000;

function readNum(raw: Record<string, unknown>, envKey: string, field: string): number | undefined {
    const v = raw[envKey] ?? raw[field];
    if (v === undefined || v === null || v === '') return undefined;
    return Number(v);
}

function readBool(raw: Record<string, unknown>, envKey: string, field: string): boolean | undefined {
    const v = raw[envKey] ?? raw[field];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v === 'true';
    return undefined;
}

/** Normalize a raw config into the consolidation config (defaults per spec §11). */
export function normalizeConsolidationConfig(
    raw: ConsolidationConfigInput = {},
): ConsolidationConfig {
    const r = raw as Record<string, unknown>;
    const graduationN = parseGraduationN(
        r.MEMORY_GRADUATION_N !== undefined ? String(r.MEMORY_GRADUATION_N) : r.graduationN !== undefined ? String(r.graduationN) : undefined,
    );
    const decayDays = Math.round(readNum(r, 'MEMORY_DECAY_DAYS', 'decayDays') ?? 30);
    const hotImportance = readNum(r, 'MEMORY_HOT_IMPORTANCE', 'hotImportance') ?? 0.8;
    const verifyMinOverlap = readNum(r, 'MEMORY_VERIFY_MIN_OVERLAP', 'verifyMinOverlap') ?? 0.3;
    const conflictOverlap = readNum(r, 'MEMORY_CONFLICT_OVERLAP', 'conflictOverlap') ?? 0.5;
    const panelRaw = r.JUDGE_PANEL_MODELS ?? r.judgePanelModels;
    const judgePanelModels = Array.isArray(panelRaw)
        ? panelRaw.map((s) => String(s))
        : typeof panelRaw === 'string' && panelRaw.trim() !== ''
            ? panelRaw.split(',').map((s) => s.trim()).filter(Boolean)
            : ['deepseek'];
    const consensusRaw = r.JUDGE_CONSENSUS ?? r.judgeConsensus;
    const judgeConsensus = consensusRaw === 'majority' ? 'majority' : 'any';
    const judgeMaxModelsPerCall = Math.round(readNum(r, 'JUDGE_MAX_MODELS_PER_CALL', 'judgeMaxModelsPerCall') ?? 3);
    const judgeTimeoutS = readNum(r, 'JUDGE_TIMEOUT_S', 'judgeTimeoutS') ?? 30;
    const judgeCaps: Partial<Record<JudgeModelName, number>> = {};
    if (readNum(r, 'JUDGE_CAP_DEEPSEEK_USD', 'deepseek') !== undefined) {
        judgeCaps.deepseek = readNum(r, 'JUDGE_CAP_DEEPSEEK_USD', 'deepseek')!;
    } else if (typeof r.judgeCaps === 'object' && r.judgeCaps !== null) {
        const caps = r.judgeCaps as Record<string, number>;
        if (typeof caps.deepseek === 'number') judgeCaps.deepseek = caps.deepseek;
    }
    if (readNum(r, 'JUDGE_CAP_GPT4_USD', 'gpt4') !== undefined) {
        judgeCaps['gpt-4'] = readNum(r, 'JUDGE_CAP_GPT4_USD', 'gpt4')!;
    } else if (typeof r.judgeCaps === 'object' && r.judgeCaps !== null) {
        const caps = r.judgeCaps as Record<string, number>;
        if (typeof caps['gpt-4'] === 'number') judgeCaps['gpt-4'] = caps['gpt-4'];
    }
    if (readNum(r, 'JUDGE_CAP_GEMINI3_USD', 'gemini3') !== undefined) {
        judgeCaps['gemini-3'] = readNum(r, 'JUDGE_CAP_GEMINI3_USD', 'gemini3')!;
    } else if (typeof r.judgeCaps === 'object' && r.judgeCaps !== null) {
        const caps = r.judgeCaps as Record<string, number>;
        if (typeof caps['gemini-3'] === 'number') judgeCaps['gemini-3'] = caps['gemini-3'];
    }
    const refNowRaw = r.refNow;
    const refNow = typeof refNowRaw === 'string' ? refNowRaw : undefined;

    return {
        graduationN,
        decayDays: decayDays > 0 ? decayDays : 30,
        hotImportance,
        verifyMinOverlap,
        conflictOverlap,
        judgePanelModels,
        judgeConsensus,
        judgeMaxModelsPerCall,
        judgeTimeoutS,
        judgeCaps,
        refNow,
    };
}

/** Judge config slice for `judgeGate` (built from the normalized config). */
function toJudgeConfig(cfg: ConsolidationConfig): JudgeConfig {
    return {
        judgeMaxModelsPerCall: cfg.judgeMaxModelsPerCall,
        judgeTimeoutS: cfg.judgeTimeoutS,
        judgeCaps: cfg.judgeCaps,
        judgeConsensus: cfg.judgeConsensus,
    };
}

/* ------------------------------------------------------------------ */
/* Cursor                                                              */
/* ------------------------------------------------------------------ */

/** Persisted consolidation cursor (spec §8.1 — resumable, survives rotation). */
export interface ConsolidationCursor {
    /** `ts` of the last fully-processed record (null = never). */
    cursor_ts: ISOTimestamp | null;
    /** `id` of the last fully-processed record. */
    last_processed: string | null;
    /** Run ids written so far (audit; spec §8.1 `cons_<uuid>` records). */
    run_records: string[];
}

/** Default cursor file path inside the memory dir. */
export function cursorFilePath(memoryDir: string): string {
    return path.join(memoryDir, 'consolidation-cursor.json');
}

/** Load the cursor (missing/corrupt → zero state). */
export async function loadCursor(memoryDir: string): Promise<ConsolidationCursor> {
    try {
        const raw = await readFile(cursorFilePath(memoryDir), 'utf8');
        const parsed = JSON.parse(raw) as Partial<ConsolidationCursor>;
        return {
            cursor_ts: typeof parsed.cursor_ts === 'string' ? parsed.cursor_ts : null,
            last_processed: typeof parsed.last_processed === 'string' ? parsed.last_processed : null,
            run_records: Array.isArray(parsed.run_records) ? parsed.run_records.map(String) : [],
        };
    } catch {
        return { cursor_ts: null, last_processed: null, run_records: [] };
    }
}

/** Persist the cursor (0600 perms). */
export async function saveCursor(memoryDir: string, cursor: ConsolidationCursor): Promise<void> {
    await mkdir(memoryDir, { recursive: true, mode: 0o700 });
    await writeFile(cursorFilePath(memoryDir), JSON.stringify(cursor, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

/** Records newer than the cursor (resumable, spec §8.1). */
export function recordsSince(cursor: ConsolidationCursor, records: readonly L2Record[]): L2Record[] {
    if (cursor.cursor_ts === null || cursor.last_processed === null) {
        return [...records];
    }
    return records.filter((r) => {
        if (r.ts > cursor.cursor_ts!) return true;
        if (r.ts === cursor.cursor_ts) return r.id > cursor.last_processed!;
        return false;
    });
}

/** The effective cursor position after processing `records` (last by ts, then id). */
export function cursorAfter(records: readonly L2Record[]): { cursor_ts: ISOTimestamp | null; last_processed: string | null } {
    if (records.length === 0) {
        return { cursor_ts: null, last_processed: null };
    }
    const last = [...records].sort((a, b) => (a.ts === b.ts ? (a.id < b.id ? -1 : 1) : a.ts < b.ts ? -1 : 1)).at(-1)!;
    return { cursor_ts: last.ts, last_processed: last.id };
}

/* ------------------------------------------------------------------ */
/* Graduation rule + single-candidate helper (T06 `runConsolidation`)  */
/* ------------------------------------------------------------------ */

/** Input of `runConsolidation` (T06 adapter surface). */
export interface RunConsolidationInput {
    candidate: CandidateInput;
    /** Single judge provider (T06 convenience). */
    judge?: PanelProvider;
    /** Panel map (alternative to `judge`). */
    providers?: Record<string, PanelProvider>;
    /** Resolved L2 records by id — enables the verifier (citation etc.). */
    observations?: Record<string, L2Record>;
    /** Active facts (conflict check). Default: read from core.md when memoryDir is set. */
    activeFacts?: FactLike[];
    /** Memory dir — when set, the L3 block + L2 audit records are actually written. */
    memoryDir?: string;
    /** Consolidation run id (default: generated `cons_<uuid>`). */
    runId?: string;
    consensus?: 'any' | 'majority';
    now?: () => Date;
    log?: Pick<Console, 'warn' | 'info' | 'debug' | 'error'>;
}

/** Outcome of `runConsolidation`. */
export interface RunConsolidationResult {
    write_performed: boolean;
    outcome: 'graduation' | 'rejection' | 'error' | 'paused';
    /** Written (or would-be) L3 block — only on graduation. */
    l3_block?: FactBlock;
    /** `rejection` L2 record — only when outcome === 'rejection'. */
    rejection_record?: L2Record;
    judge?: JudgeGateResult;
    reason?: string;
    runId: string;
    /** Distinct supporting observation count used by the rule. */
    distinct_count: number;
}

/** R-PROV-2: highest-trust provenance among supporting observations. */
const PROVENANCE_RANK: Record<string, number> = { user_stated: 3, tool_output: 2, model_inferred: 1 };

function highestProvenance(records: readonly (L2Record | undefined)[]): L2Record['provenance'] | undefined {
    let best: L2Record['provenance'] | undefined;
    let bestRank = -1;
    for (const r of records) {
        if (!r) continue;
        const rank = PROVENANCE_RANK[r.provenance] ?? 0;
        if (rank > bestRank) {
            bestRank = rank;
            best = r.provenance;
        }
    }
    return best;
}

/** Build a graduation L3 block (id assigned by the caller via CoreWriter when writing). */
export function buildGraduationBlock(
    candidate: CandidateInput,
    distinctIds: readonly string[],
    observations: Record<string, L2Record> | undefined,
    opts: { now?: Date; runId: string; provenance?: L2Record['provenance'] },
): NewFactBlock {
    const nowIso = toIsoUtc(opts.now ?? new Date());
    const records = distinctIds.map((id) => observations?.[id]);
    const provenance = opts.provenance ?? highestProvenance(records) ?? 'model_inferred';
    const importances = records.filter((r): r is L2Record => r !== undefined).map((r) => r.importance);
    const importance = importances.length > 0
        ? Math.min(1, Math.max(0, importances.reduce((a, b) => a + b, 0) / importances.length))
        : 0.7;
    const lastObserved = records
        .filter((r): r is L2Record => r !== undefined)
        .map((r) => r.ts)
        .sort()
        .at(-1) ?? nowIso;
    return {
        statement: candidate.text,
        provenance,
        importance,
        hot: false,
        valid_from: nowIso,
        source: `consolidation:${opts.runId}`,
        supporting_observations: [...distinctIds],
        observation_count: distinctIds.length,
        last_observed: lastObserved,
        title: candidate.text.slice(0, 60),
    };
}

/**
 * Run the graduation rule + judge gate (+ verifier when observations are
 * provided) for ONE candidate and, when `memoryDir` is set, perform the
 * L3/L2 writes. N < 3 → rejection (no judge call); N > 5 → config error;
 * judge/verifier failure → rejection. (T06 `runConsolidation`.)
 */
export async function runConsolidation(
    input: RunConsolidationInput,
    cfgRaw: ConsolidationConfigInput = {},
): Promise<RunConsolidationResult> {
    const cfg = normalizeConsolidationConfig(cfgRaw);
    const runId = input.runId ?? `cons_${randomUUID()}`;
    const log = input.log ?? console;
    const candidate = input.candidate;

    // Distinct supporting observations (repeated ids do NOT count — §8.4).
    const distinctIds = [...new Set(input.candidate.supporting_ids ?? [])];
    const distinct = distinctIds.length;

    if (distinct > 5) {
        throw new MemoryConfigError(
            `MEMORY_GRADUATION_N allows 3..5 distinct supporting observations; got ${distinct}`,
        );
    }
    if (distinct < cfg.graduationN) {
        const reason = `insufficient distinct supporting observations (${distinct} < ${cfg.graduationN}) — graduation rule §8.4`;
        const rejectionRecord = buildRejectionRecord(candidate, null, 'reject', reason, runId, input.now?.());
        return {
            write_performed: false,
            outcome: 'rejection',
            rejection_record: rejectionRecord,
            reason,
            runId,
            distinct_count: distinct,
        };
    }

    // Judge gate.
    const providers = input.providers ?? (input.judge ? { [input.judge.name]: input.judge } : {});
    const supportingObs = supportingObservationsOf(distinctIds, input.observations);
    const judge = await judgeGate({
        candidate,
        supporting: supportingObs,
        activeFacts: input.activeFacts,
        providers,
        consensus: input.consensus ?? cfg.judgeConsensus,
        cfg: toJudgeConfig(cfg),
        log,
    });

    if (judge.gate !== 'approve') {
        if (judge.gate === 'paused' || judge.gate === 'error') {
            return {
                write_performed: false,
                outcome: judge.gate === 'paused' ? 'paused' : 'error',
                judge,
                reason: judge.reason,
                runId,
                distinct_count: distinct,
            };
        }
        const reason = `judge gate rejected the candidate: ${judge.reasons.join('; ') || 'no approval'}`;
        const rejectionRecord = buildRejectionRecord(candidate, judge, 'reject', reason, runId, input.now?.());
        return {
            write_performed: false,
            outcome: 'rejection',
            rejection_record: rejectionRecord,
            judge,
            reason,
            runId,
            distinct_count: distinct,
        };
    }

    // Verifier (§10.5) — runs when supporting observations are resolvable.
    if (input.observations) {
        const verified = verifyCandidate({
            candidate: judge.edited_candidate,
            observations: input.observations,
            activeFacts: input.activeFacts ?? [],
            judge,
            minOverlap: cfg.verifyMinOverlap,
            conflictOverlap: cfg.conflictOverlap,
        });
        if (!verified.ok) {
            const reason = `verifier rejected the candidate: ${verified.reasons.join('; ')}`;
            const rejectionRecord = buildRejectionRecord(
                judge.edited_candidate,
                judge,
                'reject',
                reason,
                runId,
                input.now?.(),
            );
            return {
                write_performed: false,
                outcome: 'rejection',
                rejection_record: rejectionRecord,
                judge,
                reason,
                runId,
                distinct_count: distinct,
            };
        }
    }

    // Conflict routing (§10.3): a candidate contradicting an active fact
    // needs the judge-approved supersede flow, not a plain append.
    const conflicting = input.activeFacts
        ? findConflictingFacts(judge.edited_candidate, input.activeFacts, cfg.conflictOverlap)
        : [];
    if (conflicting.length > 0) {
        const res = await applyConflict(
            judge.edited_candidate,
            { activeFacts: conflicting, observations: input.observations, memoryDir: input.memoryDir, runId, now: input.now, log },
            { providers },
            cfgRaw,
        );
        return {
            write_performed: res.no_new_block ? false : true,
            outcome: res.no_new_block ? 'rejection' : 'graduation',
            l3_block: res.new_block,
            rejection_record: res.rejection_record,
            judge,
            reason: res.rejection_record ? undefined : `superseded active fact(s) ${conflicting.map((f) => f.id).join(', ')}`,
            runId,
            distinct_count: distinct,
        };
    }

    // Write L3 + audit records.
    const cons: ConsolidationContext = { runId };
    let block: FactBlock;
    if (input.memoryDir) {
        const writer = new CoreWriter(input.memoryDir, writerOptions(input.now, input.log));
        block = await writer.appendFact(cons, buildGraduationBlock(candidate, distinctIds, input.observations, { now: input.now?.(), runId }));
        await writeGraduationRecord(input.memoryDir, block, judge, runId, input.now);
    } else {
        // No memory dir: return the would-be block (T06 asserts its shape).
        const nowIso = toIsoUtc(input.now?.() ?? new Date());
        const nb = buildGraduationBlock(candidate, distinctIds, input.observations, { now: input.now?.(), runId });
        block = {
            id: 'fact_0001',
            title: nb.title ?? nb.statement.slice(0, 60),
            statement: nb.statement,
            provenance: nb.provenance,
            importance: nb.importance ?? 0.7,
            hot: nb.hot ?? false,
            valid_from: nb.valid_from ?? nowIso,
            valid_to: null,
            source: nb.source,
            supporting_observations: (nb.supporting_observations ?? []).join(', '),
            observation_count: nb.observation_count ?? distinct,
            last_observed: nb.last_observed ?? nowIso,
            status: 'active',
        };
    }

    log.info?.(`[consolidation] ${runId}: graduated ${block.id} (N=${distinct}, judge=${judge.gate})`);
    return {
        write_performed: true,
        outcome: 'graduation',
        l3_block: block,
        judge,
        runId,
        distinct_count: distinct,
    };
}

/* ------------------------------------------------------------------ */
/* Conflict / supersede (T06 `applyConflict`, spec §10.3)              */
/* ------------------------------------------------------------------ */

export interface ApplyConflictInput {
    activeFacts: FactLike[];
    observations?: Record<string, L2Record>;
    memoryDir?: string;
    runId?: string;
    now?: () => Date;
    log?: Pick<Console, 'warn' | 'info' | 'debug' | 'error'>;
}

export interface ApplyConflictResult {
    /** The system never overwrites in place (R-CORE-3/R-MEM-5). */
    no_in_place_overwrite: boolean;
    old_block?: FactBlock;
    new_block?: FactBlock;
    supersede_record?: L2Record;
    old_block_unchanged?: boolean;
    no_new_block?: boolean;
    rejection_record?: L2Record;
    judge?: JudgeGateResult;
    runId: string;
}

/** Judge-approved supersede (§10.3): old block closed, new block appended. */
export async function applyConflict(
    incoming: CandidateInput,
    opts: ApplyConflictInput,
    judgeOpts: { judge?: PanelProvider; providers?: Record<string, PanelProvider>; consensus?: 'any' | 'majority' } = {},
    cfgRaw: ConsolidationConfigInput = {},
): Promise<ApplyConflictResult> {
    const cfg = normalizeConsolidationConfig(cfgRaw);
    const runId = opts.runId ?? `cons_${randomUUID()}`;
    const log = opts.log ?? console;
    const providers = judgeOpts.providers ?? (judgeOpts.judge ? { [judgeOpts.judge.name]: judgeOpts.judge } : {});

    const conflicts = findConflictingFacts(incoming, opts.activeFacts, cfg.conflictOverlap);
    if (conflicts.length === 0) {
        return { no_in_place_overwrite: true, old_block_unchanged: true, no_new_block: true, runId };
    }
    const target = conflicts[0];

    const judge = await judgeGate({
        candidate: incoming,
        supporting: supportingObservationsOf(incoming.supporting_ids, opts.observations),
        activeFacts: conflicts,
        providers,
        consensus: judgeOpts.consensus ?? cfg.judgeConsensus,
        cfg: toJudgeConfig(cfg),
        log,
    });

    if (judge.gate !== 'approve') {
        const reason = `supersede of ${target.id} rejected by the judge gate: ${judge.reasons.join('; ') || (judge.reason ?? 'no approval')}`;
        const rejectionRecord = buildRejectionRecord(incoming, judge, 'reject', reason, runId, opts.now?.());
        return {
            no_in_place_overwrite: true,
            old_block_unchanged: true,
            no_new_block: true,
            rejection_record: rejectionRecord,
            judge,
            runId,
        };
    }

    const nowIso = toIsoUtc(opts.now?.() ?? new Date());
    const cons: ConsolidationContext = { runId };
    const distinctIds = [...new Set(incoming.supporting_ids ?? [])];
    const replacement = buildGraduationBlock(incoming, distinctIds, opts.observations, { now: opts.now?.(), runId });

    let superseded: FactBlock;
    let created: FactBlock;
    if (opts.memoryDir) {
        const writer = new CoreWriter(opts.memoryDir, writerOptions(opts.now, opts.log));
        ({ superseded, created } = await writer.supersedeFact(cons, target.id, replacement, nowIso));
        const persisted = await writeSupersedeRecord(opts.memoryDir, target.id, created.id, runId, nowIso, opts.now);
        return {
            no_in_place_overwrite: true,
            old_block: superseded,
            new_block: created,
            // The L2 record carries the mirrors on the returned object too
            // (T06 asserts `supersede_record.old_id`); the persisted line
            // stays schema-clean (SessionsWriter normalizes away extras).
            supersede_record: withSupersedeMirrors(persisted, target.id, created.id),
            judge,
            runId,
        };
    }

    // No memory dir: return the computed blocks (T06 asserts their shape).
    superseded = {
        id: target.id,
        title: target.id,
        statement: factStatementOf(target),
        provenance: 'tool_output',
        importance: 0.5,
        hot: false,
        valid_from: '1970-01-01T00:00:00.000Z',
        valid_to: nowIso,
        source: 'consolidation',
        supporting_observations: '',
        observation_count: 0,
        last_observed: nowIso,
        status: 'superseded',
    };
    created = {
        id: `fact_${String(opts.activeFacts.length + 1).padStart(4, '0')}`,
        title: replacement.title ?? replacement.statement.slice(0, 60),
        statement: replacement.statement,
        provenance: replacement.provenance,
        importance: replacement.importance ?? 0.7,
        hot: replacement.hot ?? false,
        valid_from: nowIso,
        valid_to: null,
        source: replacement.source,
        supporting_observations: (replacement.supporting_observations ?? []).join(', '),
        observation_count: replacement.observation_count ?? distinctIds.length,
        last_observed: nowIso,
        status: 'active',
    };
    const supersedeRecord: L2Record = {
        id: `evt_${randomUUID()}`,
        ts: nowIso,
        session_id: null,
        type: 'supersede',
        provenance: 'tool_output',
        importance: 0.5,
        valid_from: nowIso,
        valid_to: null,
        content: { old_id: target.id, new_id: created.id, reason: `consolidation ${runId} superseded fact ${target.id}` },
        source: { kind: 'tool', ref: 'memory:consolidation', detail: runId },
    };
    log.info?.(`[consolidation] ${runId}: superseded ${target.id} -> ${created.id} (judge approved)`);
    return {
        no_in_place_overwrite: true,
        old_block: superseded,
        new_block: created,
        supersede_record: withSupersedeMirrors(supersedeRecord, target.id, created.id),
        judge,
        runId,
    };
}

/** Mirror `old_id`/`new_id` onto the supersede record object (T06 asserts
 * `supersede_record.old_id`; the persisted line keeps them in `content`
 * per spec §5.3 — SessionsWriter normalization drops the mirrors). */
function withSupersedeMirrors(
    record: L2Record,
    oldId: string,
    newId: string,
): L2Record & { old_id: string; new_id: string } {
    return { ...record, old_id: oldId, new_id: newId };
}

/* ------------------------------------------------------------------ */
/* Decay / anti-drift (T06 `applyDecay`, spec §10.4)                   */
/* ------------------------------------------------------------------ */

export interface ApplyDecayInput {
    fact_id: string;
    importance_before: number;
    last_observed: ISOTimestamp;
    status?: FactStatus;
}

export interface ApplyDecayResult {
    fact_id: string;
    cycles_elapsed: number;
    /** Number of decay cycles applied (T06 asserts === 2 for ~60 days). */
    decay_records: number;
    reason?: 'day30';
    importance_before: number;
    importance_after: number;
    status: FactStatus;
    stale: boolean;
    hot_demoted: boolean;
    last_observed: ISOTimestamp;
}

/**
 * Day-30 decay (spec §10.4): a fact not re-observed for
 * `MEMORY_DECAY_DAYS` loses importance — halved per 30-day cycle (floor
 * 0.1); 2 cycles without re-observation (~60 days) → `stale`; a hot fact
 * falling below `MEMORY_HOT_IMPORTANCE` is demoted. Pure/deterministic —
 * the job persists the outcome.
 */
export function applyDecay(
    input: ApplyDecayInput,
    cfgRaw: ConsolidationConfigInput = {},
): ApplyDecayResult {
    const cfg = normalizeConsolidationConfig(cfgRaw);
    const refNow = cfg.refNow ?? toIsoUtc(new Date());
    const ageMs = Date.parse(refNow) - Date.parse(input.last_observed);
    const ageDays = Math.max(0, ageMs / DAY_MS);
    const cycles = Math.floor(ageDays / cfg.decayDays);
    const half = Math.pow(0.5, cycles);
    const importanceAfter = Math.max(0.1, input.importance_before * half);
    const stale = cycles >= 2;
    const hotDemoted = input.importance_before >= cfg.hotImportance && importanceAfter < cfg.hotImportance;
    return {
        fact_id: input.fact_id,
        cycles_elapsed: cycles,
        decay_records: cycles,
        reason: cycles > 0 ? 'day30' : undefined,
        importance_before: input.importance_before,
        importance_after: importanceAfter,
        status: stale ? 'stale' : (input.status ?? 'active'),
        stale,
        hot_demoted: hotDemoted,
        last_observed: input.last_observed,
    };
}

/* ------------------------------------------------------------------ */
/* Full job (spec §8.1/§8.2 pipeline)                                  */
/* ------------------------------------------------------------------ */

export interface ConsolidationJobOptions {
    memoryDir: string;
    cfg?: ConsolidationConfigInput;
    /** Provider panel map (default: built from cfg + the registry). */
    providers?: Record<string, PanelProvider>;
    /** Reflection LLM (spec §8.3 — "small LLM"; default: the first panel model). */
    reflector?: PanelProvider;
    now?: () => Date;
    log?: Pick<Console, 'warn' | 'info' | 'debug' | 'error'>;
    /** Cursor file override (tests). */
    cursorFile?: string;
}

export interface ConsolidationJobResult {
    runId: string;
    cursor: ConsolidationCursor;
    processed: number;
    observations: number;
    reflections: number;
    candidates: number;
    graduated: number;
    rejected: number;
    superseded: number;
    decayed: number;
    hot_demoted: number;
    paused: boolean;
    errors: string[];
    durationMs: number;
    run_record?: L2Record;
}

/** Schedule helper (spec §8.1 — `MEMORY_CONSOLIDATE_EVERY_MIN`). */
export function consolidationDue(
    lastRunAt: Date | null,
    now: Date,
    everyMin: number,
): boolean {
    if (lastRunAt === null) return true;
    return now.getTime() - lastRunAt.getTime() >= everyMin * 60_000;
}

/**
 * Run the full consolidation job once (spec §8): decay pass, then
 * extract → reflect → candidate → graduation → judge → verifier → write
 * for the new observations since the cursor. Idempotent/resumable via
 * the cursor; writes a `cons_<uuid>` run record.
 */
export async function runConsolidationJob(opts: ConsolidationJobOptions): Promise<ConsolidationJobResult> {
    const started = Date.now();
    const cfg = normalizeConsolidationConfig(opts.cfg);
    const runId = `cons_${randomUUID()}`;
    const log = opts.log ?? console;
    const now = opts.now ?? (() => new Date());
    const memoryDir = opts.memoryDir;

    const result: ConsolidationJobResult = {
        runId,
        cursor: await loadCursor(memoryDir),
        processed: 0,
        observations: 0,
        reflections: 0,
        candidates: 0,
        graduated: 0,
        rejected: 0,
        superseded: 0,
        decayed: 0,
        hot_demoted: 0,
        paused: false,
        errors: [],
        durationMs: 0,
    };

    try {
        const sessions = new SessionsWriter(memoryDir, { now, log });
        const core = new CoreWriter(memoryDir, { now, log });

        // 1. New records since the cursor (§8.1).
        const { records } = await sessions.readAll();
        const newRecords = recordsSince(result.cursor, records);
        result.processed = newRecords.length;
        const observations = newRecords.filter((r) => r.type === 'observation');
        result.observations = observations.length;
        const observationMap: Record<string, L2Record> = {};
        for (const r of records) observationMap[r.id] = r;

        // 2. Decay pass (§10.4) — deterministic, runs even without a panel.
        const decayOutcome = await runDecayPass({ sessions, core, cfg, runId, now, log });
        result.decayed += decayOutcome.decayed;
        result.hot_demoted += decayOutcome.hotDemoted;

        // 3. Reflection + graduation pipeline (§8.2) — needs an enabled panel.
        // resolvePanel applies BOTH the isEnabled() gate (SEC-KEY-03) and the
        // per-model cost caps (SEC-COST-01): an empty panel means the
        // pipeline pauses safely — no unjudged write ever.
        const rawPanel = opts.providers && Object.keys(opts.providers).length > 0
            ? Object.values(opts.providers)
            : buildPanelFromConfig({ judgePanelModels: cfg.judgePanelModels }, { providers: opts.providers });
        const resolved = await resolvePanel(rawPanel, {
            panelModels: cfg.judgePanelModels,
            caps: cfg.judgeCaps,
            maxModels: cfg.judgeMaxModelsPerCall,
        });
        if (resolved.panel.length === 0) {
            result.paused = true;
            const why = resolved.disabled.length > 0 ? 'all judge models capped' : 'no enabled judge model';
            log.warn?.(`[consolidation] ${runId}: ${why} — graduation paused (SEC-COST-01); skipped=${resolved.skipped.join(',')} disabled=${resolved.disabled.join(',')}`);
        } else {
            const activeFacts = (await core.read()).facts
                .filter((f) => f.status === 'active')
                .map((f) => ({ id: f.id, statement: f.statement }));
            const pipeline = await runGraduationPipeline({
                sessions,
                core,
                cfg,
                runId,
                now,
                log,
                panel: resolved.panel,
                reflector: opts.reflector ?? resolved.panel[0],
                observations,
                observationMap,
                activeFacts,
            });
            result.reflections += pipeline.reflections;
            result.candidates += pipeline.candidates;
            result.graduated += pipeline.graduated;
            result.rejected += pipeline.rejected;
            result.superseded += pipeline.superseded;
        }

        // 4. Write the run record, then advance the cursor past EVERYTHING
        //    (including this run's own reflection/graduation/run records) so
        //    a re-run is idempotent (§8.1 — resumes from the last fully
        //    processed record).
        const runRecord: L2Record = {
            id: runId,
            ts: toIsoUtc(now()),
            session_id: null,
            type: 'consolidation',
            provenance: 'tool_output',
            importance: 0.5,
            valid_from: toIsoUtc(now()),
            valid_to: null,
            content: {
                run_id: runId,
                status: result.paused ? 'paused' : 'ok',
                processed: result.processed,
                graduated: result.graduated,
                rejected: result.rejected,
                superseded: result.superseded,
                decayed: result.decayed,
                message: result.paused
                    ? 'judge panel paused (all enabled models capped or missing keys) — SEC-COST-01'
                    : undefined,
            },
            source: { kind: 'tool', ref: 'memory:consolidation', detail: runId },
        };
        await sessions.append(runRecord);
        result.run_record = runRecord;

        const finalRecords = (await sessions.readAll()).records;
        const pos = cursorAfter(finalRecords);
        const nextCursor: ConsolidationCursor = {
            cursor_ts: pos.cursor_ts ?? result.cursor.cursor_ts,
            last_processed: pos.last_processed ?? result.cursor.last_processed,
            run_records: [...result.cursor.run_records, runId],
        };
        await saveCursor(memoryDir, nextCursor);
        result.cursor = nextCursor;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(message);
        log.error?.(`[consolidation] ${runId}: run failed: ${message}`);
        // §8.1: a failing run writes a `cons_<uuid>` error record.
        try {
            const sessions = new SessionsWriter(memoryDir, { now, log });
            await sessions.append({
                id: runId,
                ts: toIsoUtc(now()),
                session_id: null,
                type: 'error',
                provenance: 'tool_output',
                importance: 0.5,
                valid_from: toIsoUtc(now()),
                valid_to: null,
                content: { code: 'consolidation_failed', message: message.slice(0, 500) },
                source: { kind: 'tool', ref: 'memory:consolidation', detail: runId },
            });
        } catch {
            // Best effort — the original error is the real failure.
        }
        throw err;
    } finally {
        result.durationMs = Date.now() - started;
    }
    return result;
}

/* ------------------------------------------------------------------ */
/* Job internals                                                       */
/* ------------------------------------------------------------------ */

interface DecayPassResult {
    decayed: number;
    hotDemoted: number;
}

/** Day-30 decay pass (§10.4): idempotent via the L2 `decay` record trail. */
async function runDecayPass(deps: {
    sessions: SessionsWriter;
    core: CoreWriter;
    cfg: ConsolidationConfig;
    runId: string;
    now: () => Date;
    log: Pick<Console, 'warn' | 'info' | 'debug' | 'error'>;
}): Promise<DecayPassResult> {
    const { sessions, core, cfg, runId, now, log } = deps;
    const cons: ConsolidationContext = { runId };
    const doc = await core.read();
    const { records } = await sessions.readAll();
    const decayTsByFact = new Map<string, string>();
    for (const r of records) {
        if (r.type === 'decay') {
            const factId = (r.content as { fact_id?: string }).fact_id;
            if (factId && (!decayTsByFact.has(factId) || r.ts > decayTsByFact.get(factId)!)) {
                decayTsByFact.set(factId, r.ts);
            }
        }
    }

    let decayed = 0;
    let hotDemoted = 0;
    for (const fact of doc.facts) {
        if (fact.status !== 'active' && fact.status !== 'stale') continue;
        const lastDecay = decayTsByFact.get(fact.id);
        // Anchor: the most recent re-observation or decay (both reset the
        // 30-day clock). Facts already stale are skipped (nothing to decay).
        const anchor = lastDecay && lastDecay > fact.last_observed ? lastDecay : fact.last_observed;
        const ageMs = Date.parse(toIsoUtc(now())) - Date.parse(anchor);
        const cycles = Math.floor(Math.max(0, ageMs) / DAY_MS / cfg.decayDays);
        if (cycles < 1 || fact.status === 'stale') continue;

        const before = fact.importance;
        const after = Math.max(0.1, before * Math.pow(0.5, cycles));
        const stale = cycles >= 2;
        const demote = fact.hot && after < cfg.hotImportance;

        // One decay record per cycle (audit trail; §10.4 "writes a decay record").
        for (let i = 0; i < cycles; i++) {
            const stepBefore = Math.max(0.1, before * Math.pow(0.5, i));
            const stepAfter = Math.max(0.1, before * Math.pow(0.5, i + 1));
            await sessions.append({
                type: 'decay',
                provenance: 'tool_output',
                content: { fact_id: fact.id, importance_before: stepBefore, importance_after: stepAfter, reason: 'day30' },
                source: { kind: 'tool', ref: 'memory:consolidation', detail: runId },
            });
            decayed += 1;
        }
        if (demote) {
            await sessions.append({
                type: 'hot_demote',
                provenance: 'tool_output',
                content: { fact_id: fact.id, importance: after },
                source: { kind: 'tool', ref: 'memory:consolidation', detail: runId },
            });
            hotDemoted += 1;
        }
        await core.updateStatus(cons, fact.id, {
            importance: after,
            hot: demote ? false : fact.hot,
            status: stale ? 'stale' : fact.status,
        });
        log.info?.(`[consolidation] ${runId}: decay ${fact.id} importance ${before} -> ${after} (${cycles} cycle(s), ${stale ? 'stale' : 'active'})`);
    }
    return { decayed, hotDemoted };
}

interface GraduationPipelineResult {
    reflections: number;
    candidates: number;
    graduated: number;
    rejected: number;
    superseded: number;
}

/** Extract → reflect → candidate → graduation → judge → verifier → write. */
async function runGraduationPipeline(deps: {
    sessions: SessionsWriter;
    core: CoreWriter;
    cfg: ConsolidationConfig;
    runId: string;
    now: () => Date;
    log: Pick<Console, 'warn' | 'info' | 'debug' | 'error'>;
    panel: PanelProvider[];
    reflector: PanelProvider;
    observations: L2Record[];
    observationMap: Record<string, L2Record>;
    activeFacts: FactLike[];
}): Promise<GraduationPipelineResult> {
    const { sessions, core, cfg, runId, now, log, panel, reflector, observations, observationMap, activeFacts } = deps;
    const out: GraduationPipelineResult = { reflections: 0, candidates: 0, graduated: 0, rejected: 0, superseded: 0 };

    const clusters = clusterObservations(observations);
    const providers: Record<string, PanelProvider> = {};
    for (const p of panel) providers[p.name] = p;

    for (const cluster of clusters) {
        const distinctIds = [...new Set(cluster.map((o) => o.id))];
        if (distinctIds.length < cfg.graduationN) continue;

        // Reflect (§8.3): compress the trajectory into {context, error, fix}.
        const lesson = await reflect(
            { observations: cluster.map((o) => observationText(o)).filter(Boolean) },
            { provider: reflector, log },
        );
        const reflectionRecord: L2Record = {
            id: `evt_${randomUUID()}`,
            ts: toIsoUtc(now()),
            session_id: null,
            type: 'reflection',
            provenance: 'model_inferred',
            importance: 0.5,
            valid_from: toIsoUtc(now()),
            valid_to: null,
            content: { ...lesson },
            source: { kind: 'model', ref: 'memory:consolidation:reflect', detail: runId },
            meta: { model: reflector.modelId, run_id: runId },
        };
        await sessions.append(reflectionRecord);
        out.reflections += 1;

        // Candidate (§8.2 stage 3): the reusable correction as the statement.
        const candidate: CandidateInput = {
            tier: 'L3',
            text: lesson.fix,
            supporting_ids: distinctIds,
        };
        out.candidates += 1;

        const res = await runConsolidation(
            {
                candidate,
                providers,
                observations: observationMap,
                activeFacts,
                memoryDir: sessions.dir,
                runId,
                now,
                log,
            },
            cfg,
        );
        if (res.outcome === 'graduation') {
            out.graduated += 1;
            if (res.reason?.startsWith('superseded')) out.superseded += 1;
        } else if (res.outcome === 'rejection') {
            out.rejected += 1;
        }
    }
    return out;
}

/** Deterministic topic clustering of observations (stage 1, §8.2). */
export function clusterObservations(observations: readonly L2Record[]): L2Record[][] {
    const sorted = [...observations].sort((a, b) => (a.ts === b.ts ? (a.id < b.id ? -1 : 1) : a.ts < b.ts ? -1 : 1));
    const clusters: L2Record[][] = [];
    for (const obs of sorted) {
        const text = observationText(obs);
        if (text === '') continue;
        let placed = false;
        for (const cluster of clusters) {
            const rep = observationText(cluster[0]);
            if (rep !== '' && topicOverlap(rep, text) >= TOPIC_OVERLAP_THRESHOLD) {
                cluster.push(obs);
                placed = true;
                break;
            }
        }
        if (!placed) {
            clusters.push([obs]);
        }
    }
    return clusters;
}

/** Topic-overlap for clustering (same as the verifier's statement overlap). */
const TOPIC_OVERLAP_THRESHOLD = 0.2;
function topicOverlap(a: string, b: string): number {
    const tokensA = tokenizeLocal(a);
    const tokensB = new Set(tokenizeLocal(b));
    if (tokensA.length === 0) return 0;
    const common = tokensA.filter((t) => tokensB.has(t)).length;
    return common / tokensA.length;
}

function tokenizeLocal(text: string): string[] {
    return String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Text payload of an observation record. */
export function observationText(record: L2Record): string {
    const content = record.content as Record<string, unknown>;
    return typeof content.text === 'string' ? content.text : '';
}

/** Resolve supporting observations for the judge prompt (§9.3.1/9.3.2). */
function supportingObservationsOf(
    ids: readonly string[],
    observations: Record<string, L2Record> | undefined,
): { id: string; text: string; provenance: L2Record['provenance'] }[] {
    const out: { id: string; text: string; provenance: L2Record['provenance'] }[] = [];
    for (const id of ids) {
        const r = observations?.[id];
        if (r) {
            out.push({ id, text: observationText(r), provenance: r.provenance });
        }
    }
    return out;
}

/** Extract the statement text of a fact-like object. */
function factStatementOf(fact: FactLike): string {
    return fact.statement ?? fact.text ?? '';
}

/* ------------------------------------------------------------------ */
/* L2 audit records (R-JUDGE-5, §8.4 failure path)                     */
/* ------------------------------------------------------------------ */

/** Build a `rejection` L2 record (R-JUDGE-5, §8.4 failure). */
function buildRejectionRecord(
    candidate: CandidateInput,
    judge: JudgeGateResult | null,
    verdict: 'reject' | 'revise',
    reason: string,
    runId: string,
    now: Date | undefined,
): L2Record {
    const nowIso = toIsoUtc(now ?? new Date());
    const judgeName = judge ? Object.keys(judge.per_model).join(',') || 'panel' : 'rule';
    return {
        id: `evt_${randomUUID()}`,
        ts: nowIso,
        session_id: null,
        type: 'rejection',
        provenance: 'tool_output',
        importance: 0.5,
        valid_from: nowIso,
        valid_to: null,
        content: {
            tier: candidate.tier,
            text: candidate.text,
            judge: judgeName,
            verdict,
            reason,
        },
        source: { kind: 'tool', ref: 'memory:consolidation', detail: runId },
    };
}

/** Write the `graduation` L2 record after an approved L3 append (R-JUDGE-5). */
async function writeGraduationRecord(
    memoryDir: string,
    block: FactBlock,
    judge: JudgeGateResult,
    runId: string,
    now: (() => Date) | undefined,
): Promise<L2Record> {
    const sessions = new SessionsWriter(memoryDir, writerOptions(now, console));
    const nowIso = toIsoUtc(now?.() ?? new Date());
    const approving = Object.entries(judge.per_model)
        .filter(([, v]) => v === 'approve')
        .map(([name]) => name);
    const record: L2Record = {
        id: `evt_${randomUUID()}`,
        ts: nowIso,
        session_id: null,
        type: 'graduation',
        provenance: 'tool_output',
        importance: 0.5,
        valid_from: nowIso,
        valid_to: null,
        content: {
            tier: 'L3',
            fact_id: block.id,
            judge: approving.join(',') || 'panel',
            verdict: 'approve',
        },
        source: { kind: 'tool', ref: 'memory:consolidation', detail: runId },
        meta: { observation_count: block.observation_count, run_id: runId },
    };
    await sessions.append(record);
    return record;
}

/** Write the `supersede` L2 record after a judge-approved supersede (§10.3). */
async function writeSupersedeRecord(
    memoryDir: string,
    oldId: string,
    newId: string,
    runId: string,
    nowIso: ISOTimestamp,
    now: (() => Date) | undefined,
): Promise<L2Record> {
    const sessions = new SessionsWriter(memoryDir, writerOptions(now, console));
    const record: L2Record = {
        id: `evt_${randomUUID()}`,
        ts: nowIso,
        session_id: null,
        type: 'supersede',
        provenance: 'tool_output',
        importance: 0.5,
        valid_from: nowIso,
        valid_to: null,
        content: { old_id: oldId, new_id: newId, reason: `consolidation ${runId} superseded fact ${oldId}` },
        source: { kind: 'tool', ref: 'memory:consolidation', detail: runId },
    };
    await sessions.append(record);
    return record;
}

/**
 * Aliases for the T06 adapter surface (`mod.consolidate ?? mod.run`):
 * both point at the full consolidation job (spec §8).
 */
export const consolidate = runConsolidationJob;
export const run = runConsolidationJob;
