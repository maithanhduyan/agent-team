/**
 * agent-desktop — core memory module (T03)
 *
 * Data contract types for the memory foundation, per
 * `docs/memory-spec.md` §4–§6 (T01, PR #9) and
 * `docs/security-review-memory.md` SEC-MEM-01 (T02, PR #10).
 *
 * - L2 episodic records live in `memory/sessions.jsonl` (§5.2–§5.3).
 * - L3 semantic fact blocks live in `memory/core.md` (§6.2).
 */

/** ISO 8601 UTC with millisecond precision, `Z` suffix — e.g. `2026-09-01T12:34:56.789Z`. */
export type ISOTimestamp = string;

/** Mandatory provenance tag (spec §4.3). Exactly one of these three. */
export type Provenance = 'user_stated' | 'model_inferred' | 'tool_output';

/** Origin kind of a record's `source` (spec §5.2, anti-poisoning §10.2.1). */
export type SourceKind = 'user' | 'tool' | 'model' | 'bridge';

/** Origin of a record (spec §5.2 `source`, mandatory). */
export interface Source {
    kind: SourceKind;
    ref: string;
    detail?: string;
}

/** Record types defined in spec §5.3. */
export type L2RecordType =
    | 'session_start'
    | 'session_end'
    | 'observation'
    | 'tool_call'
    | 'reflection'
    | 'candidate'
    | 'graduation'
    | 'rejection'
    | 'supersede'
    | 'decay'
    | 'hot_promote'
    | 'hot_demote'
    | 'quarantine'
    | 'consolidation'   // T05 run record (id cons_<uuid>, spec §8.1; ADR-013)
    | 'error';

/** Consolidation run record statuses (T05, ADR-013). */
export type ConsolidationRunStatus = 'ok' | 'error' | 'paused';

/** Observation kinds (spec §5.3 `observation.content.kind`). */
export type ObservationKind =
    | 'user_message'
    | 'tool_result'
    | 'model_statement'
    | 'preference'
    | 'fact';

/** Type-specific `content` payloads (spec §5.3 — required keys are the contract). */
export type RecordContent =
    | { channel: string; summary?: string }                                     // session_start
    | { reason: 'timeout' | 'user' | 'error'; duration_s?: number }             // session_end
    | { text: string; kind: ObservationKind }                                   // observation
    | { tool: string; args?: Record<string, unknown>; ok: boolean }             // tool_call
    | { context: string; error: string; fix: string }                           // reflection
    | { tier: 'L3' | 'L4'; text: string; supporting_ids: string[] }             // candidate
    | { tier: 'L3' | 'L4'; fact_id: string; judge: string; verdict: 'approve' } // graduation
    | { tier: 'L3' | 'L4'; text: string; judge: string; verdict: 'reject' | 'revise'; reason: string } // rejection
    | { old_id: string; new_id: string; reason: string }                        // supersede
    | { fact_id: string; importance_before: number; importance_after: number; reason: 'day30' } // decay
    | { fact_id: string; importance: number }                                   // hot_promote / hot_demote
    | { reason: 'injection_pattern' | 'no_source' | 'conflict'; text: string; snippet?: string } // quarantine
    | { run_id: string; status: ConsolidationRunStatus; processed: number; graduated: number; rejected: number; superseded: number; decayed: number; message?: string } // consolidation (T05 run record)
    | { code: string; message: string };                                        // error

/** One line of `sessions.jsonl` (spec §5.2). */
export interface L2Record {
    id: string;
    ts: ISOTimestamp;
    session_id: string | null;
    type: L2RecordType;
    provenance: Provenance;
    importance: number;
    valid_from: ISOTimestamp;
    valid_to: ISOTimestamp | null;
    content: RecordContent;
    source: Source;
    meta?: Record<string, unknown>;
}

/** Fact block status (spec §6.2). */
export type FactStatus = 'active' | 'superseded' | 'expired' | 'stale';

/** One curated fact block in `core.md` (spec §6.2). */
export interface FactBlock {
    /** Assigned id `fact_<n>` (monotonic counter per file). */
    id: string;
    /** Short title on the `##` heading line. */
    title: string;
    statement: string;
    provenance: Provenance;
    importance: number;
    hot: boolean;
    valid_from: ISOTimestamp;
    /** `null` = open (still valid). */
    valid_to: ISOTimestamp | null;
    /** Origin reference (anti-poisoning chain). */
    source: string;
    /** Comma-separated L2 record ids. */
    supporting_observations: string;
    observation_count: number;
    last_observed: ISOTimestamp;
    status: FactStatus;
}

/** Header of `core.md` (spec §6.1, YAML front matter). */
export interface CoreMdHeader {
    memory_version: number;
    updated: ISOTimestamp;
    count: number;
}

/** Parsed `core.md`: header + fact blocks in file order. */
export interface CoreMdDocument {
    header: CoreMdHeader;
    facts: FactBlock[];
}

/** Allowed `provenance` values (spec §4.3). */
export const PROVENANCE_VALUES: readonly Provenance[] = [
    'user_stated',
    'model_inferred',
    'tool_output',
];

/** Allowed `source.kind` values (spec §5.2). */
export const SOURCE_KIND_VALUES: readonly SourceKind[] = [
    'user',
    'tool',
    'model',
    'bridge',
];

/** Allowed record types (spec §5.3). */
export const RECORD_TYPE_VALUES: readonly L2RecordType[] = [
    'session_start',
    'session_end',
    'observation',
    'tool_call',
    'reflection',
    'candidate',
    'graduation',
    'rejection',
    'supersede',
    'decay',
    'hot_promote',
    'hot_demote',
    'quarantine',
    'consolidation',
    'error',
];

/** Allowed fact statuses (spec §6.2). */
export const FACT_STATUS_VALUES: readonly FactStatus[] = [
    'active',
    'superseded',
    'expired',
    'stale',
];
