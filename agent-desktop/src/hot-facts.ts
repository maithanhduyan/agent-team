/**
 * Hot-fact injection (spec §6.3, §7.3, US-MEM-005).
 *
 * At session start the bridge/runner loads hot facts from `core.md`
 * (**0 ms — a plain file read, no retrieval**) and injects them into the
 * system prompt as data, wrapped in the SEC-MEM-01 envelope
 * (`renderHotFacts`, §10.2.3).
 *
 * Selection (spec §6.3, R-CORE-2) runs on the **Day-30 decay
 * projection** (§10.4, Redmine #39): before selecting, each fact is
 * projected forward from its `last_observed` to `now` — importance is
 * halved per `MEMORY_DECAY_DAYS` cycle (floor 0.1), `stale` after 2
 * cycles, and a hot fact whose projected importance falls below the hot
 * threshold is demoted. This keeps a session start that happens *before*
 * the first consolidation run from injecting facts that the decay policy
 * (§10.4) already considers decayed. The projection is a pure read-time
 * view over `core.md` only (no L2 read, no writes); the consolidation
 * job remains the authority that persists decay into `core.md`.
 *
 * After the projection a fact is selected when:
 * - `hot: true` AND `status: active` AND `importance >=
 *   MEMORY_HOT_IMPORTANCE` (default 0.8), and the validity window is
 *   open at `now` (R-CORE-2 / §5.4: `valid_from <= now`, `valid_to` open
 *   or future).
 * - Ordered by importance desc (ties by id asc — deterministic), capped
 *   at `MEMORY_HOT_MAX` (default 10).
 *
 * A missing/empty `core.md` yields zero hot facts (not an error).
 */

import { CoreWriter } from './core-writer.js';
import { parseIsoToMs } from './retrieval.js';
import { renderHotFacts } from './render.js';
import type { FactBlock, FactStatus, ISOTimestamp } from './types.js';

/** Default min importance for a hot fact (spec §6.3 / §11). */
export const DEFAULT_HOT_IMPORTANCE = 0.8;
/** Default max hot facts injected (spec §6.3 / §11). */
export const DEFAULT_HOT_MAX = 10;
/** Day-30 decay period in days (spec §10.4 / `MEMORY_DECAY_DAYS`). */
export const DEFAULT_DECAY_DAYS = 30;
/** Importance floor after decay cycles (spec §10.4). */
export const DEFAULT_DECAY_FLOOR = 0.1;

const DAY_MS = 86_400_000;

export interface HotFactsOptions {
    /** Min `importance` for a hot fact (default 0.8). */
    minImportance?: number;
    /** Max hot facts (default 10). */
    max?: number;
    /** Day-30 decay period in days for the read-time projection (default 30). */
    decayDays?: number;
    /** Importance floor after decay cycles (default 0.1). */
    decayFloor?: number;
    /** Injectable clock (deterministic tests). */
    now?: () => Date;
    /** Logger for warnings. Default: console. */
    log?: Pick<Console, 'warn' | 'info'>;
}

/** One hot fact as injected (rendered via `renderHotFacts`). */
export interface HotFact {
    id: string;
    statement: string;
    provenance: string;
    importance: number;
    valid_from: ISOTimestamp | null;
}

/** Day-30 decay projection of one fact at `nowMs` (spec §10.4). */
export interface DecayProjection {
    /** Projected importance (`max(floor, importance · 0.5^cycles)`). */
    importance: number;
    /** `stale` after 2 cycles without re-observation, else the fact's status. */
    status: FactStatus;
    /** False when the fact was not hot, went stale, or fell below the hot threshold. */
    hot: boolean;
    /** Whole 30-day decay cycles elapsed since `last_observed`. */
    cycles: number;
    /** True after ≥ 2 cycles without re-observation (≈ 60 days). */
    stale: boolean;
}

/**
 * Pure Day-30 decay projection (spec §10.4, Redmine #39). Mirrors the
 * `applyDecay` math of the consolidation job (T05) for the read-time
 * hot-fact view: a fact not re-observed for `decayDays` loses importance
 * — halved per cycle (floor `decayFloor`); 2 cycles without
 * re-observation (~60 days) → `stale`; a hot fact falling below
 * `hotImportance` is demoted. Deterministic — same inputs, same output;
 * no file access.
 *
 * @param fact The raw fact fields read from `core.md`.
 * @param nowMs Reference instant (ms since epoch) the projection is anchored at.
 */
export function projectDay30Decay(
    fact: Pick<FactBlock, 'importance' | 'hot' | 'last_observed' | 'status'>,
    nowMs: number,
    options: { decayDays?: number; decayFloor?: number; hotImportance?: number } = {},
): DecayProjection {
    const decayDays = options.decayDays ?? DEFAULT_DECAY_DAYS;
    const floor = options.decayFloor ?? DEFAULT_DECAY_FLOOR;
    const hotThreshold = options.hotImportance ?? DEFAULT_HOT_IMPORTANCE;

    const observedMs = parseIsoToMs(fact.last_observed);
    // An unparseable `last_observed` is treated as fresh (no decay) —
    // deterministic fallback, mirrors `recencyScore`.
    const ageMs = Number.isFinite(observedMs) ? nowMs - observedMs : 0;
    const cycles = decayDays > 0 ? Math.floor(Math.max(0, ageMs) / DAY_MS / decayDays) : 0;

    const importance = Math.max(floor, fact.importance * Math.pow(0.5, cycles));
    const stale = cycles >= 2;
    const status: FactStatus = stale ? 'stale' : fact.status;
    const hot = fact.hot && !stale && importance >= hotThreshold;
    return { importance, status, hot, cycles, stale };
}

/**
 * Load hot facts from `core.md` (spec §6.3). File read only — no
 * retrieval, no scoring, no other files. Selection runs on the Day-30
 * decay projection (§10.4, Redmine #39) so decayed facts are never
 * injected, even when the session starts before the first consolidation.
 * Returns facts ordered by importance desc, capped at `max`.
 */
export async function loadHotFacts(memoryDir: string, options: HotFactsOptions = {}): Promise<HotFact[]> {
    const minImportance = options.minImportance ?? DEFAULT_HOT_IMPORTANCE;
    const max = options.max ?? DEFAULT_HOT_MAX;
    const nowIso = options.now?.().toISOString() ?? new Date().toISOString();
    const nowMs = parseIsoToMs(nowIso);

    const core = new CoreWriter(memoryDir, { log: options.log });
    const doc = await core.read();

    const hot: HotFact[] = [];
    for (const fact of doc.facts) {
        // Day-30 decay projection (§10.4): importance halved per cycle,
        // stale at 2 cycles, hot demoted below the threshold.
        const projected = projectDay30Decay(fact, nowMs, {
            decayDays: options.decayDays,
            decayFloor: options.decayFloor,
            hotImportance: minImportance,
        });
        if (!projected.hot || projected.status !== 'active') {
            continue;
        }
        if (projected.importance < minImportance) {
            continue;
        }
        // R-CORE-2 / §5.4: the validity window must be open at `now`.
        const fromMs = parseIsoToMs(fact.valid_from);
        if (!Number.isFinite(fromMs) || fromMs > nowMs) {
            continue;
        }
        if (fact.valid_to !== null) {
            const toMs = parseIsoToMs(fact.valid_to);
            if (!Number.isFinite(toMs) || toMs <= nowMs) {
                continue;
            }
        }
        hot.push({
            id: fact.id,
            statement: fact.statement,
            provenance: fact.provenance,
            importance: projected.importance,
            valid_from: fact.valid_from,
        });
    }

    // Ordered by importance desc, ties by id asc (deterministic, §6.3).
    hot.sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id));
    return hot.slice(0, max);
}

/** Result of the session-start injection. */
export interface HotFactsInjection {
    /** The hot facts loaded (≤ max, ordered by importance). */
    facts: HotFact[];
    /** SEC-MEM-01-wrapped block to inject into the system prompt. */
    block: string;
}

/**
 * Build the session-start hot-facts block (spec §6.3/§7.3): loads hot
 * facts and renders them through the SEC-MEM-01 envelope ("data, not
 * instructions", §10.2.3). 0 ms — a single `core.md` file read.
 */
export async function injectHotFacts(memoryDir: string, options: HotFactsOptions = {}): Promise<HotFactsInjection> {
    const facts = await loadHotFacts(memoryDir, options);
    return { facts, block: renderHotFacts(facts) };
}
