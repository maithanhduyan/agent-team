/**
 * `search_memory` tool (spec §7.1, ADR-005, US-MEM-003).
 *
 * Ranked search over L2 (`sessions.jsonl` + archives, via the
 * rotation-transparent `SessionsWriter.readAll`) and L3 (`core.md`, via
 * `CoreWriter.read` / `parseCoreMd`).
 *
 * Ranking uses the contract formula (spec §7.1):
 *
 *     score = α · similarity + β · recency + γ · importance
 *
 * - similarity: deterministic Jaccard on tokens (`retrieval.ts`);
 * - recency: exponential half-life decay (`retrieval.ts`);
 * - importance: the record's `importance` field.
 *
 * Behavioral contract (spec §7.1):
 * - Active records only (`valid_from <= now`, `valid_to` open or future)
 *   unless `include_expired: true`.
 * - Results sorted by `score` desc; ties by `ts` desc (then `id` asc for
 *   full determinism).
 * - `top_k` and `min_score` both applied (a result must satisfy both).
 * - Empty query → error. Unknown layer → error. No matches → empty
 *   `results` (not an error).
 * - Deterministic output for identical inputs (T06 testability). `now`
 *   is injectable; it defaults to the current time.
 *
 * SEC-MEM-01: results must be rendered into prompts via
 * `renderSearchResults` (see `render.ts`) — never plain tool output.
 */

import { CoreWriter } from './core-writer.js';
import { recordText } from './injection.js';
import {
    jaccardSimilarity,
    parseIsoToMs,
    recencyScore,
    retrievalScore,
    tokenize,
    type RetrievalWeights,
    type SimilarityFn,
} from './retrieval.js';
import { SessionsWriter } from './sessions-writer.js';
import type { FactBlock, FactStatus, ISOTimestamp, L2Record, Provenance } from './types.js';

/** Thrown on invalid `search_memory` parameters (empty query, unknown layer, …). */
export class SearchMemoryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SearchMemoryError';
    }
}

/** Allowed `layers` values (spec §7.1). */
export const SEARCH_LAYERS = ['L2', 'L3'] as const;
export type SearchLayer = (typeof SEARCH_LAYERS)[number];

export interface SearchMemoryParams {
    /** Required, non-empty query (spec §7.1). */
    query: string;
    /** Tiers to search; default `["L2","L3"]`. */
    layers?: SearchLayer[];
    /** Max results; default 10, range 1..50. */
    top_k?: number;
    /** Minimum score; default 0.1, range 0..1. */
    min_score?: number;
    /** Include records whose validity window has closed; default false. */
    include_expired?: boolean;
    /** Restrict to one or more provenance tags; default null (all). */
    provenance?: Provenance[] | null;
    /** Lower bound on `ts` (ISO 8601 UTC); default null (all). */
    since?: ISOTimestamp | null;
    /** Restrict to one session id; default null (all). */
    session_id?: string | null;
}

/** One ranked result (spec §7.1). */
export interface SearchMemoryResult {
    id: string;
    tier: 'L2' | 'L3';
    ts: ISOTimestamp;
    provenance: Provenance;
    importance: number;
    /** Final score in [0,1], sorted desc. */
    score: number;
    /** Statement / content text used for similarity scoring. */
    text: string;
    valid_from: ISOTimestamp;
    valid_to: ISOTimestamp | null;
    /** L3 only: fact status (spec §7.1). */
    status?: FactStatus;
    /** Origin reference: L3 fact `source`, L2 record `source.ref`. */
    source: string;
}

export interface SearchMemoryMeta {
    took_ms: number;
    hits: number;
    query: string;
}

export interface SearchMemoryOutput {
    results: SearchMemoryResult[];
    meta: SearchMemoryMeta;
}

export interface SearchMemoryOptions {
    /** Retrieval weights α/β/γ (must sum to 1). */
    weights: RetrievalWeights;
    /** Recency half-life in days (default 30). */
    halfLifeDays: number;
    /** Similarity function; defaults to Jaccard (§7.1 — embedding slot). */
    similarity?: SimilarityFn;
    /** Injectable clock for `now`/active-window evaluation (determinism). */
    now?: () => Date;
    /** Logger for warnings (corrupt lines). Default: console. */
    log?: Pick<Console, 'warn' | 'info'>;
}

/** Defaults per spec §7.1. */
export const DEFAULT_TOP_K = 10;
export const DEFAULT_MIN_SCORE = 0.1;
export const MIN_TOP_K = 1;
export const MAX_TOP_K = 50;

/** Validate params and return normalized values (throws SearchMemoryError). */
export function validateSearchParams(params: SearchMemoryParams): Required<
    Pick<SearchMemoryParams, 'query' | 'layers' | 'top_k' | 'min_score' | 'include_expired' | 'provenance' | 'since' | 'session_id'>
> {
    const query = typeof params.query === 'string' ? params.query.trim() : '';
    if (query === '') {
        throw new SearchMemoryError('empty query: `query` must be a non-empty string (spec §7.1)');
    }
    if (tokenize(query).length === 0) {
        throw new SearchMemoryError('empty query: `query` must contain at least one word token (spec §7.1)');
    }

    const layers = params.layers ?? ['L2', 'L3'];
    if (!Array.isArray(layers) || layers.length === 0) {
        throw new SearchMemoryError('invalid layers: must be a non-empty array of "L2" | "L3" (spec §7.1)');
    }
    for (const layer of layers) {
        if (layer !== 'L2' && layer !== 'L3') {
            throw new SearchMemoryError(`unknown layer "${String(layer)}": expected "L2" or "L3" (spec §7.1)`);
        }
    }

    const topK = params.top_k ?? DEFAULT_TOP_K;
    if (!Number.isInteger(topK) || topK < MIN_TOP_K || topK > MAX_TOP_K) {
        throw new SearchMemoryError(`invalid top_k: must be an integer in [${MIN_TOP_K}, ${MAX_TOP_K}], got ${topK}`);
    }

    const minScore = params.min_score ?? DEFAULT_MIN_SCORE;
    if (typeof minScore !== 'number' || Number.isNaN(minScore) || minScore < 0 || minScore > 1) {
        throw new SearchMemoryError(`invalid min_score: must be a float in [0,1], got ${minScore}`);
    }

    const includeExpired = params.include_expired ?? false;

    const provenance = params.provenance ?? null;
    if (provenance !== null) {
        if (!Array.isArray(provenance)) {
            throw new SearchMemoryError('invalid provenance: must be an array of provenance tags or null');
        }
        const allowed = new Set(['user_stated', 'model_inferred', 'tool_output']);
        for (const p of provenance) {
            if (!allowed.has(p)) {
                throw new SearchMemoryError(`unknown provenance "${String(p)}": expected user_stated|model_inferred|tool_output`);
            }
        }
    }

    const since = params.since ?? null;
    if (since !== null && !Number.isFinite(parseIsoToMs(since))) {
        throw new SearchMemoryError(`invalid since: "${since}" is not an ISO 8601 timestamp`);
    }

    const sessionId = params.session_id ?? null;
    if (sessionId !== null && typeof sessionId !== 'string') {
        throw new SearchMemoryError('invalid session_id: must be a string or null');
    }

    return { query, layers, top_k: topK, min_score: minScore, include_expired: includeExpired, provenance, since, session_id: sessionId };
}

/** True if a record/fact is active at `now` (spec §5.4 / §7.1). */
export function isActiveAt(validFrom: string, validTo: ISOTimestamp | null, nowMs: number): boolean {
    const fromMs = parseIsoToMs(validFrom);
    if (!Number.isFinite(fromMs) || fromMs > nowMs) {
        return false;
    }
    if (validTo === null) {
        return true;
    }
    const toMs = parseIsoToMs(validTo);
    return Number.isFinite(toMs) && toMs > nowMs;
}

/** Text used for scoring a fact block (spec §7.1: `statement`). */
export function factText(fact: FactBlock): string {
    return fact.statement;
}

/** Text used for scoring an L2 record: `content.text` when present, else all content strings. */
export function l2Text(record: L2Record): string {
    const content = record.content as Record<string, unknown>;
    if (typeof content.text === 'string' && content.text.trim() !== '') {
        return content.text;
    }
    return recordText(record);
}

interface Candidate {
    id: string;
    tier: 'L2' | 'L3';
    ts: string;
    provenance: Provenance;
    importance: number;
    text: string;
    valid_from: string;
    valid_to: string | null;
    status?: FactStatus;
    source: string;
}

/** Build a candidate from an L2 record (spec §7.1 result shape). */
function l2Candidate(record: L2Record): Candidate {
    return {
        id: record.id,
        tier: 'L2',
        ts: record.ts,
        provenance: record.provenance,
        importance: record.importance,
        text: l2Text(record),
        valid_from: record.valid_from,
        valid_to: record.valid_to,
        source: record.source.ref,
    };
}

/** Build a candidate from an L3 fact block (spec §7.1 result shape). */
function l3Candidate(fact: FactBlock): Candidate {
    return {
        id: fact.id,
        tier: 'L3',
        ts: fact.last_observed,
        provenance: fact.provenance,
        importance: fact.importance,
        text: factText(fact),
        valid_from: fact.valid_from,
        valid_to: fact.valid_to,
        status: fact.status,
        source: fact.source,
    };
}

/**
 * `search_memory` — ranked retrieval over L2 + L3 (spec §7.1).
 * Returns active records by default, filtered and ranked by the
 * contract formula. Pure aside from file reads and the `took_ms` clock.
 */
export async function searchMemory(
    memoryDir: string,
    params: SearchMemoryParams,
    options: SearchMemoryOptions,
): Promise<SearchMemoryOutput> {
    const started = Date.now();
    const v = validateSearchParams(params);
    const nowIso = options.now?.().toISOString() ?? new Date().toISOString();
    const nowMs = parseIsoToMs(nowIso);
    const similarity = options.similarity ?? jaccardSimilarity;
    const queryTokens = tokenize(v.query);

    const wantL2 = v.layers.includes('L2');
    const wantL3 = v.layers.includes('L3');

    const candidates: Candidate[] = [];

    if (wantL2) {
        const reader = new SessionsWriter(memoryDir, { log: options.log });
        const { records } = await reader.readAll();
        for (const record of records) {
            if (!passesFilters(record.ts, record.valid_from, record.valid_to, record.provenance, record.session_id, v, nowMs)) {
                continue;
            }
            candidates.push(l2Candidate(record));
        }
    }

    if (wantL3) {
        const core = new CoreWriter(memoryDir);
        const doc = await core.read();
        for (const fact of doc.facts) {
            if (!passesFilters(fact.last_observed, fact.valid_from, fact.valid_to, fact.provenance, null, v, nowMs)) {
                continue;
            }
            candidates.push(l3Candidate(fact));
        }
    }

    const scored = candidates.map((c) => {
        const docTokens = tokenize(c.text);
        const sim = similarity(queryTokens, docTokens);
        const recency = recencyScore(c.ts, nowIso, options.halfLifeDays);
        const score = retrievalScore(sim, recency, c.importance, options.weights);
        return { candidate: c, score };
    });

    // Both `top_k` and `min_score` apply (spec §7.1): a result must
    // satisfy the score floor before the count cap is applied.
    const filtered = scored.filter((s) => s.score >= v.min_score);
    filtered.sort((a, b) =>
        b.score - a.score ||
        compareIsoDesc(a.candidate.ts, b.candidate.ts) ||
        a.candidate.id.localeCompare(b.candidate.id),
    );
    const results = filtered.slice(0, v.top_k).map(({ candidate: c, score }) => ({
        id: c.id,
        tier: c.tier,
        ts: c.ts,
        provenance: c.provenance,
        importance: c.importance,
        score,
        text: c.text,
        valid_from: c.valid_from,
        valid_to: c.valid_to,
        ...(c.status !== undefined ? { status: c.status } : {}),
        source: c.source,
    }));

    return {
        results,
        meta: { took_ms: Date.now() - started, hits: results.length, query: v.query },
    };
}

function compareIsoDesc(a: string, b: string): number {
    const aMs = parseIsoToMs(a);
    const bMs = parseIsoToMs(b);
    if (Number.isFinite(aMs) && Number.isFinite(bMs)) {
        return bMs - aMs;
    }
    return b.localeCompare(a);
}

interface NormalizedParams {
    include_expired: boolean;
    provenance: Provenance[] | null;
    since: ISOTimestamp | null;
    session_id: string | null;
}

/** Apply the spec §7.1 filters (active window, provenance, since, session). */
function passesFilters(
    ts: string,
    validFrom: string,
    validTo: string | null,
    provenance: Provenance,
    sessionId: string | null,
    v: NormalizedParams,
    nowMs: number,
): boolean {
    if (!v.include_expired && !isActiveAt(validFrom, validTo, nowMs)) {
        return false;
    }
    if (v.provenance !== null && !v.provenance.includes(provenance)) {
        return false;
    }
    if (v.since !== null && parseIsoToMs(ts) < parseIsoToMs(v.since)) {
        return false;
    }
    if (v.session_id !== null && sessionId !== v.session_id) {
        return false;
    }
    return true;
}
