/**
 * Configuration for the memory module (T03 writers + T04 retrieval tools).
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
 *
 * T05 (consolidation) extends this surface further
 * (`MEMORY_GRADUATION_N`, `MEMORY_DECAY_DAYS`, `JUDGE_*`, ...).
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
    };
}
