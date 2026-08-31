/**
 * Configuration for the memory module (T03 writers + T04 retrieval tools
 * + T05 consolidation job).
 *
 * Env surface per spec §11:
 * - `MEMORY_DIR` — memory data directory (default `<project>/memory`).
 * - `MEMORY_ROTATE_MB` — `sessions.jsonl` rotation size in MB (default 100,
 *   spec §5.5 / §11).
 * - `MEMORY_INJECTION_PATTERNS` — comma-separated ADDITIONAL injection
 *   patterns appended to the shipped defaults (spec §10.2.2 / §11; defaults
 *   are never replaced, see `injection.ts`).
 * - `MEMORY_ALPHA/BETA/GAMMA` — retrieval weights (default 0.5/0.3/0.2,
 *   must sum to 1, spec §7.1 / §11; validated in `retrieval.ts`).
 * - `MEMORY_RECENCY_HALF_LIFE_DAYS` — recency decay half-life (default 30).
 * - `MEMORY_HOT_IMPORTANCE` — min importance for hot facts (default 0.8).
 * - `MEMORY_HOT_MAX` — max hot facts injected (default 10).
 * - `MEMORY_MAX_TOOL_CALLS_PER_TURN` — agentic retrieval budget (default 5).
 * - `MEMORY_RUNS_DIR` — DSH run-log directory for `grep_logs(files: "runs")`
 *   (default `<project>/.agent-team/runs`, spec §7.2).
 * - T05 (consolidation) adds: `MEMORY_GRADUATION_N`, `MEMORY_DECAY_DAYS`,
 *   `MEMORY_VERIFY_MIN_OVERLAP`, `MEMORY_CONSOLIDATE_EVERY_MIN`,
 *   `MEMORY_CONFLICT_OVERLAP`, `JUDGE_PANEL_MODELS`, `JUDGE_CONSENSUS`,
 *   `JUDGE_MAX_MODELS_PER_CALL`, `JUDGE_TIMEOUT_S`, `JUDGE_CAP_*_USD`
 *   (spec §8–§10 / §11).
 */

import { DEFAULT_INJECTION_PATTERNS } from './injection.js';
import {
    DEFAULT_ALPHA,
    DEFAULT_BETA,
    DEFAULT_GAMMA,
    DEFAULT_HALF_LIFE_DAYS,
    parseHalfLifeDays,
    parseRetrievalWeights,
    type RetrievalWeights,
} from './retrieval.js';

/** Thrown when a memory config value is invalid (spec §11 hard errors). */
export class MemoryConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MemoryConfigError';
    }
}

/** Per-model judge monthly cost caps in USD (spec §9.5). */
export interface JudgeCaps {
    deepseek: number;
    gpt4: number;
    gemini3: number;
}

export interface MemoryConfig {
    /** Memory data directory (canonical layout `memory/` inside the project root). */
    memoryDir: string;
    /** Rotation threshold in bytes for `sessions.jsonl` (spec §5.5). */
    rotateBytes: number;
    /** Injection patterns: shipped defaults + configured additions. */
    injectionPatterns: string[];
    /** Retrieval weights α/β/γ (sums to 1, spec §7.1). */
    retrievalWeights: RetrievalWeights;
    /** Recency decay half-life in days (spec §7.1, Day-30 policy §10.4). */
    recencyHalfLifeDays: number;
    /** Min importance for a fact to be injected as hot (§6.3). */
    hotImportance: number;
    /** Max hot facts injected at session start (§6.3). */
    hotMax: number;
    /** Agentic retrieval budget per turn (§7.3, US-MEM-006 AC-2). */
    maxToolCallsPerTurn: number;
    /** DSH run-log directory for `grep_logs(files: "runs")` (§7.2). */
    runsDir: string;
    // ---- T05 consolidation (spec §8–§10 / §11) ----
    /** Graduation observation count N (default 3, validated 3..5, §8.4). */
    graduationN: number;
    /** Decay period in days (Day-30, §10.4). */
    decayDays: number;
    /** Verifier citation token-overlap threshold (default 0.3, §10.5). */
    verifyMinOverlap: number;
    /** Consolidation schedule interval in minutes (§8.1). */
    consolidateEveryMin: number;
    /** Conflict-overlap threshold for supersede detection (default 0.5, §10.3, ADR-013). */
    conflictOverlap: number;
    /** Enabled judge models in priority order (default `deepseek`, §9.4). */
    judgePanelModels: string[];
    /** Judge consensus mode `any` | `majority` (default `any`, §9.4). */
    judgeConsensus: 'any' | 'majority';
    /** Max judge panel size per verdict (default 3, §9.4). */
    judgeMaxModelsPerCall: number;
    /** Per-model judge timeout in seconds (default 30, §9.4). */
    judgeTimeoutS: number;
    /** Per-model monthly cost caps USD (defaults 15/10/10, §9.5). */
    judgeCaps: JudgeCaps;
}

/** Parse `MEMORY_HOT_IMPORTANCE` (default 0.8); invalid → fallback. */
export function parseHotImportance(value: string | undefined, fallback = 0.8): number {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
        return fallback;
    }
    return n;
}

/** Parse `MEMORY_HOT_MAX` (default 10); invalid → fallback. */
export function parseHotMax(value: string | undefined, fallback = 10): number {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        return fallback;
    }
    return n;
}

/** Parse `MEMORY_MAX_TOOL_CALLS_PER_TURN` (default 5); invalid → fallback. */
export function parseMaxToolCallsPerTurn(value: string | undefined, fallback = 5): number {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        return fallback;
    }
    return n;
}

/** Parse `MEMORY_ROTATE_MB`; invalid values fall back to the default 100. */
export function parseRotateMb(value: string | undefined, fallbackMb = 100): number {
    if (value === undefined || value.trim() === '') {
        return fallbackMb;
    }
    const mb = Number(value);
    if (!Number.isFinite(mb) || mb <= 0) {
        return fallbackMb;
    }
    return mb;
}

/** Split a comma-separated pattern list, trimmed and de-duplicated. */
export function parsePatternList(value: string | undefined): string[] {
    if (value === undefined || value.trim() === '') {
        return [];
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of value.split(',')) {
        const pattern = raw.trim();
        if (pattern.length > 0 && !seen.has(pattern.toLowerCase())) {
            seen.add(pattern.toLowerCase());
            out.push(pattern);
        }
    }
    return out;
}

/** Parse `MEMORY_GRADUATION_N` (default 3). Must be an integer in 3..5
 * (spec §8.4 — validated at boot, hard error like the retrieval weights). */
export function parseGraduationN(value: string | undefined, fallback = 3): number {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n < 3 || n > 5) {
        throw new MemoryConfigError(
            `MEMORY_GRADUATION_N must be an integer in 3..5 (spec §8.4), got "${value}"`,
        );
    }
    return n;
}

/** Parse `MEMORY_DECAY_DAYS` (default 30, Day-30 policy §10.4); invalid → fallback. */
export function parseDecayDays(value: string | undefined, fallback = 30): number {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        return fallback;
    }
    return n;
}

/** Parse `MEMORY_VERIFY_MIN_OVERLAP` (default 0.3, §10.5); invalid → fallback. */
export function parseVerifyMinOverlap(value: string | undefined, fallback = 0.3): number {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
        return fallback;
    }
    return n;
}

/** Parse `MEMORY_CONSOLIDATE_EVERY_MIN` (default 360, §8.1); invalid → fallback. */
export function parseConsolidateEveryMin(value: string | undefined, fallback = 360): number {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        return fallback;
    }
    return n;
}

/** Parse `MEMORY_CONFLICT_OVERLAP` (default 0.5, §10.3 — ADR-013 internal knob); invalid → fallback. */
export function parseConflictOverlap(value: string | undefined, fallback = 0.5): number {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
        return fallback;
    }
    return n;
}

/** Parse `JUDGE_PANEL_MODELS` (default `deepseek`, §9.4) — comma-separated, priority order. */
export function parseJudgePanelModels(value: string | undefined, fallback: string[] = ['deepseek']): string[] {
    if (value === undefined || value.trim() === '') {
        return [...fallback];
    }
    const out = parsePatternList(value);
    return out.length > 0 ? out : [...fallback];
}

/** Parse `JUDGE_CONSENSUS` (default `any`, §9.4); invalid → fallback. */
export function parseJudgeConsensus(
    value: string | undefined,
    fallback: 'any' | 'majority' = 'any',
): 'any' | 'majority' {
    if (value === 'any' || value === 'majority') {
        return value;
    }
    return fallback;
}

/** Parse `JUDGE_MAX_MODELS_PER_CALL` (default 3, §9.4); invalid → fallback. */
export function parseJudgeMaxModelsPerCall(value: string | undefined, fallback = 3): number {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        return fallback;
    }
    return n;
}

/** Parse `JUDGE_TIMEOUT_S` (default 30, §9.4); invalid → fallback. */
export function parseJudgeTimeoutS(value: string | undefined, fallback = 30): number {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
        return fallback;
    }
    return n;
}

/** Parse a `JUDGE_CAP_*_USD` value (spec §9.5); invalid → fallback. */
export function parseJudgeCapUsd(value: string | undefined, fallback: number): number {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
        return fallback;
    }
    return n;
}

/**
 * Load the memory configuration from the environment. `baseDir` is the
 * agent-desktop project root used to resolve the default `memoryDir`
 * when `MEMORY_DIR` is not set (spec §4.1: canonical `memory/` layout).
 */
export function loadMemoryConfig(
    env: NodeJS.ProcessEnv = process.env,
    baseDir = process.cwd(),
): MemoryConfig {
    const memoryDir = env.MEMORY_DIR?.trim() || `${baseDir}/memory`;
    const rotateBytes = Math.round(parseRotateMb(env.MEMORY_ROTATE_MB, 100) * 1024 * 1024);
    const injectionPatterns = [
        ...DEFAULT_INJECTION_PATTERNS,
        ...parsePatternList(env.MEMORY_INJECTION_PATTERNS),
    ];
    const retrievalWeights = parseRetrievalWeights(env);
    const recencyHalfLifeDays = parseHalfLifeDays(env.MEMORY_RECENCY_HALF_LIFE_DAYS, DEFAULT_HALF_LIFE_DAYS);
    const hotImportance = parseHotImportance(env.MEMORY_HOT_IMPORTANCE);
    const hotMax = parseHotMax(env.MEMORY_HOT_MAX);
    const maxToolCallsPerTurn = parseMaxToolCallsPerTurn(env.MEMORY_MAX_TOOL_CALLS_PER_TURN);
    const runsDir = env.MEMORY_RUNS_DIR?.trim() || `${baseDir}/.agent-team/runs`;
    return {
        memoryDir,
        rotateBytes,
        injectionPatterns,
        retrievalWeights,
        recencyHalfLifeDays,
        hotImportance,
        hotMax,
        maxToolCallsPerTurn,
        runsDir,
        // ---- T05 consolidation ----
        graduationN: parseGraduationN(env.MEMORY_GRADUATION_N),
        decayDays: parseDecayDays(env.MEMORY_DECAY_DAYS),
        verifyMinOverlap: parseVerifyMinOverlap(env.MEMORY_VERIFY_MIN_OVERLAP),
        consolidateEveryMin: parseConsolidateEveryMin(env.MEMORY_CONSOLIDATE_EVERY_MIN),
        conflictOverlap: parseConflictOverlap(env.MEMORY_CONFLICT_OVERLAP),
        judgePanelModels: parseJudgePanelModels(env.JUDGE_PANEL_MODELS),
        judgeConsensus: parseJudgeConsensus(env.JUDGE_CONSENSUS),
        judgeMaxModelsPerCall: parseJudgeMaxModelsPerCall(env.JUDGE_MAX_MODELS_PER_CALL),
        judgeTimeoutS: parseJudgeTimeoutS(env.JUDGE_TIMEOUT_S),
        judgeCaps: {
            deepseek: parseJudgeCapUsd(env.JUDGE_CAP_DEEPSEEK_USD, 15),
            gpt4: parseJudgeCapUsd(env.JUDGE_CAP_GPT4_USD, 10),
            gemini3: parseJudgeCapUsd(env.JUDGE_CAP_GEMINI3_USD, 10),
        },
    };
}
