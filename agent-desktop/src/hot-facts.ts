/**
 * Hot-fact injection (spec §6.3, §7.3, US-MEM-005).
 *
 * At session start the bridge/runner loads hot facts from `core.md`
 * (**0 ms — a plain file read, no retrieval**) and injects them into the
 * system prompt as data, wrapped in the SEC-MEM-01 envelope
 * (`renderHotFacts`, §10.2.3).
 *
 * Selection (spec §6.3, R-CORE-2):
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
import type { ISOTimestamp } from './types.js';

/** Default min importance for a hot fact (spec §6.3 / §11). */
export const DEFAULT_HOT_IMPORTANCE = 0.8;
/** Default max hot facts injected (spec §6.3 / §11). */
export const DEFAULT_HOT_MAX = 10;

export interface HotFactsOptions {
    /** Min `importance` for a hot fact (default 0.8). */
    minImportance?: number;
    /** Max hot facts (default 10). */
    max?: number;
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

/**
 * Load hot facts from `core.md` (spec §6.3). File read only — no
 * retrieval, no scoring, no other files. Returns facts ordered by
 * importance desc, capped at `max`.
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
        if (!fact.hot || fact.status !== 'active') {
            continue;
        }
        if (fact.importance < minImportance) {
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
            importance: fact.importance,
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
