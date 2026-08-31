/**
 * Retrieval scoring primitives (spec §7.1, ADR-005).
 *
 * `search_memory` ranks records by
 *
 *     score(record) = α · similarity(query, record)
 *                   + β · recency(record)
 *                   + γ · importance(record)
 *
 * with defaults α = 0.5, β = 0.3, γ = 0.2 (α + β + γ = 1),
 * configurable via `MEMORY_ALPHA/BETA/GAMMA` (validated to sum to 1).
 *
 * - **similarity ∈ [0,1]:** v0.4 uses a deterministic lexical measure —
 *   **Jaccard similarity over lowercased word tokens**
 *   (`|Q ∩ D| / |Q ∪ D|`). It is pure, hand-computable (golden-set
 *   testable within 1e-6, spec §13/§7.1) and unit-testable. The
 *   `SimilarityFn` seam is where an embedding provider slots in later
 *   (out of scope v0.4).
 * - **recency ∈ [0,1]:** exponential half-life decay on `record.ts`:
 *   `recency = exp(-ln(2) · age_days / HALF_LIFE)`, default
 *   `HALF_LIFE = 30` days (`MEMORY_RECENCY_HALF_LIFE_DAYS`), so a
 *   record 30 days old scores 0.5, 60 days old 0.25 (aligned with the
 *   Day-30 decay policy §10.4).
 * - **importance ∈ [0,1]:** the record's `importance` field.
 *
 * All functions here are **pure and deterministic** — `now` is always
 * passed in, never read from the clock — so T06 can pin the formula
 * with hand-computed golden sets.
 */

/** Half-life constant for the recency decay (spec §7.1): ln(2). */
export const LN2 = Math.LN2;

/** Default retrieval weights (spec §7.1 / §11). */
export const DEFAULT_ALPHA = 0.5;
export const DEFAULT_BETA = 0.3;
export const DEFAULT_GAMMA = 0.2;

/** Default recency half-life in days (spec §7.1 / §11, Day-30 policy). */
export const DEFAULT_HALF_LIFE_DAYS = 30;

/** Retrieval weights; MUST sum to 1 (validated by `parseRetrievalWeights`). */
export interface RetrievalWeights {
    alpha: number;
    beta: number;
    gamma: number;
}

/** Seam for pluggable similarity (embedding slot reserved by §7.1). */
export type SimilarityFn = (queryTokens: string[], docTokens: string[]) => number;

/** Thrown when retrieval configuration is invalid (weights not summing to 1). */
export class RetrievalConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RetrievalConfigError';
    }
}

/**
 * Tokenize text for lexical similarity: lowercase, split on non-letter /
 * non-number runs, drop empty tokens. Deterministic. Keeps Vietnamese
 * diacritics (`\p{L}`) so "người dùng" and "nguoi dung" do not collide.
 */
export function tokenize(text: string): string[] {
    const matches = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
    return matches ?? [];
}

/** Set-based Jaccard similarity `|A ∩ B| / |A ∪ B|` over token sets. */
export function jaccardSimilarity(queryTokens: string[], docTokens: string[]): number {
    if (queryTokens.length === 0 || docTokens.length === 0) {
        return 0;
    }
    const querySet = new Set(queryTokens);
    const docSet = new Set(docTokens);
    let intersection = 0;
    for (const token of querySet) {
        if (docSet.has(token)) {
            intersection += 1;
        }
    }
    const union = querySet.size + docSet.size - intersection;
    if (union === 0) {
        return 0;
    }
    return intersection / union;
}

/** Milliseconds in a day (for recency age computation). */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parse an ISO 8601 UTC timestamp to epoch ms; NaN if unparseable. */
export function parseIsoToMs(iso: string): number {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : Number.NaN;
}

/**
 * Recency by exponential half-life decay (spec §7.1):
 * `recency = exp(-ln(2) · age_days / HALF_LIFE)`.
 * `now` and `ts` are ISO 8601 UTC strings; age is clamped at 0 (a
 * future-dated record is fully recent). Returns 0 when the timestamp
 * cannot be parsed (deterministic fallback).
 */
export function recencyScore(ts: string, now: string, halfLifeDays = DEFAULT_HALF_LIFE_DAYS): number {
    if (halfLifeDays <= 0) {
        return 0;
    }
    const tsMs = parseIsoToMs(ts);
    const nowMs = parseIsoToMs(now);
    if (!Number.isFinite(tsMs) || !Number.isFinite(nowMs)) {
        return 0;
    }
    const ageDays = Math.max(0, (nowMs - tsMs) / MS_PER_DAY);
    return Math.exp(-LN2 * ageDays / halfLifeDays);
}

/** Score one record: `α·similarity + β·recency + γ·importance` (spec §7.1). */
export function retrievalScore(
    similarity: number,
    recency: number,
    importance: number,
    weights: RetrievalWeights,
): number {
    return weights.alpha * similarity + weights.beta * recency + weights.gamma * importance;
}

/** Parse one env float; NaN/invalid falls back to `fallback`. */
function parseFloatEnv(value: string | undefined, fallback: number): number {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse `MEMORY_ALPHA/BETA/GAMMA` into validated weights.
 * Each weight must be a finite number in [0,1] and the sum must equal 1
 * within 1e-9 (spec §7.1: "validated to sum to 1"). A configuration that
 * does not sum to 1 is a hard error (misconfiguration must not silently
 * change the ranking contract).
 */
export function parseRetrievalWeights(
    env: NodeJS.ProcessEnv = process.env,
): RetrievalWeights {
    const alpha = parseFloatEnv(env.MEMORY_ALPHA, DEFAULT_ALPHA);
    const beta = parseFloatEnv(env.MEMORY_BETA, DEFAULT_BETA);
    const gamma = parseFloatEnv(env.MEMORY_GAMMA, DEFAULT_GAMMA);
    for (const [name, value] of [['MEMORY_ALPHA', alpha], ['MEMORY_BETA', beta], ['MEMORY_GAMMA', gamma]] as const) {
        if (value < 0 || value > 1) {
            throw new RetrievalConfigError(`${name} must be in [0,1], got ${value}`);
        }
    }
    if (Math.abs(alpha + beta + gamma - 1) > 1e-9) {
        throw new RetrievalConfigError(
            `retrieval weights must sum to 1 (spec §7.1), got α=${alpha} β=${beta} γ=${gamma} (sum=${alpha + beta + gamma})`,
        );
    }
    return { alpha, beta, gamma };
}

/** Parse `MEMORY_RECENCY_HALF_LIFE_DAYS` (default 30); invalid → fallback. */
export function parseHalfLifeDays(value: string | undefined, fallback = DEFAULT_HALF_LIFE_DAYS): number {
    const days = parseFloatEnv(value, fallback);
    return days > 0 ? days : fallback;
}
