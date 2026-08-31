/**
 * Configuration for the core memory module (T03).
 *
 * Env surface per spec §11 (subset relevant to the writers):
 * - `MEMORY_DIR` — memory data directory (default `<project>/memory`).
 * - `MEMORY_ROTATE_MB` — `sessions.jsonl` rotation size in MB (default 100,
 *   spec §5.5 / §11).
 * - `MEMORY_INJECTION_PATTERNS` — comma-separated ADDITIONAL injection
 *   patterns appended to the shipped defaults (spec §10.2.2 / §11; defaults
 *   are never replaced, see `injection.ts`).
 *
 * T04 (retrieval tools) and T05 (consolidation) extend this surface with
 * their own vars (`MEMORY_ALPHA/BETA/GAMMA`, `MEMORY_GRADUATION_N`, ...).
 */

import { DEFAULT_INJECTION_PATTERNS } from './injection.js';

export interface MemoryConfig {
    /** Memory data directory (canonical layout `memory/` inside the project root). */
    memoryDir: string;
    /** Rotation threshold in bytes for `sessions.jsonl` (spec §5.5). */
    rotateBytes: number;
    /** Injection patterns: shipped defaults + configured additions. */
    injectionPatterns: string[];
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
    return { memoryDir, rotateBytes, injectionPatterns };
}
