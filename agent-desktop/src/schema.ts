/**
 * Schema validation for L2 records (`sessions.jsonl`, spec §5.2–§5.3) and
 * L3 fact blocks (`core.md`, spec §6.2).
 *
 * A record missing any mandatory field (id, ts, type, provenance, source),
 * with an out-of-range `importance`, or with a `content` payload missing a
 * required key for its `type` is schema-invalid and rejected by the writer
 * (R-PROV-1, spec §4.3 / §10.1). Unknown record types on read are tolerated
 * (skipped with a warning) per spec §5.3.
 */

import {
    FACT_STATUS_VALUES,
    PROVENANCE_VALUES,
    RECORD_TYPE_VALUES,
    SOURCE_KIND_VALUES,
    type FactBlock,
    type L2Record,
    type L2RecordType,
    type RecordContent,
} from './types.js';

/** ISO 8601 UTC with milliseconds and `Z` suffix: `2026-09-01T12:34:56.789Z`. */
const ISO_UTC_MS_RE =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface ValidationResult {
    ok: boolean;
    errors: string[];
}

function isRecord(obj: unknown): obj is Record<string, unknown> {
    return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

function isIsoUtc(value: unknown): boolean {
    return typeof value === 'string' && ISO_UTC_MS_RE.test(value);
}

function isNonEmptyString(value: unknown): boolean {
    return typeof value === 'string' && value.length > 0;
}

/** Required `content` keys per record type (spec §5.3). */
const CONTENT_REQUIRED_KEYS: Record<L2RecordType, readonly string[]> = {
    session_start: ['channel'],
    session_end: ['reason'],
    observation: ['text', 'kind'],
    tool_call: ['tool', 'ok'],
    reflection: ['context', 'error', 'fix'],
    candidate: ['tier', 'text', 'supporting_ids'],
    graduation: ['tier', 'fact_id', 'judge', 'verdict'],
    rejection: ['tier', 'text', 'judge', 'verdict', 'reason'],
    supersede: ['old_id', 'new_id', 'reason'],
    decay: ['fact_id', 'importance_before', 'importance_after', 'reason'],
    hot_promote: ['fact_id', 'importance'],
    hot_demote: ['fact_id', 'importance'],
    quarantine: ['reason', 'text'],
    consolidation: ['run_id', 'status', 'processed', 'graduated', 'rejected', 'superseded', 'decayed'],
    error: ['code', 'message'],
};

/**
 * Validate an L2 record against the schema of spec §5.2–§5.3.
 * Returns `{ok: true}` plus a normalized record, or `{ok: false, errors}`.
 */
export function validateL2Record(input: unknown): ValidationResult & { record?: L2Record } {
    const errors: string[] = [];

    if (!isRecord(input)) {
        return { ok: false, errors: ['record must be a JSON object'] };
    }

    // id — mandatory, non-empty string (spec §5.2)
    if (!isNonEmptyString(input.id)) {
        errors.push('missing mandatory field: id (string)');
    }

    // ts — mandatory ISO 8601 UTC (spec §5.2 / §4.2)
    if (!isIsoUtc(input.ts)) {
        errors.push('missing or invalid mandatory field: ts (ISO 8601 UTC, ms precision, Z suffix)');
    }

    // type — mandatory, one of §5.3
    if (!RECORD_TYPE_VALUES.includes(input.type as L2RecordType)) {
        errors.push(`invalid or missing mandatory field: type (one of ${RECORD_TYPE_VALUES.join(', ')})`);
    }

    // provenance — mandatory (R-PROV-1, spec §4.3 / §10.1)
    if (!PROVENANCE_VALUES.includes(input.provenance as L2Record['provenance'])) {
        errors.push(
            'missing or invalid mandatory field: provenance ' +
            `(one of ${PROVENANCE_VALUES.join(', ')}) — R-PROV-1: a record without a valid provenance tag is rejected`,
        );
    }

    // source — mandatory, source.kind in {user, tool, model, bridge} (§10.2.1)
    if (!isRecord(input.source)) {
        errors.push('missing mandatory field: source (object) — source-gated write (§10.2.1)');
    } else {
        if (!SOURCE_KIND_VALUES.includes(input.source.kind as L2Record['source']['kind'])) {
            errors.push(`invalid source.kind (one of ${SOURCE_KIND_VALUES.join(', ')}) — no verifiable origin (§10.2.1)`);
        }
        if (!isNonEmptyString(input.source.ref)) {
            errors.push('missing source.ref (string) — origin reference is required');
        }
    }

    // importance — mandatory float in [0,1] (spec §4.2 / §5.2)
    if (typeof input.importance !== 'number' || Number.isNaN(input.importance) ||
        input.importance < 0 || input.importance > 1) {
        errors.push('invalid or missing mandatory field: importance (float in [0,1])');
    }

    // valid_from — mandatory ISO; valid_to — optional (null when open) (spec §5.4)
    if (!isIsoUtc(input.valid_from)) {
        errors.push('missing or invalid mandatory field: valid_from (ISO 8601 UTC)');
    }
    if (input.valid_to !== undefined && input.valid_to !== null && !isIsoUtc(input.valid_to)) {
        errors.push('invalid optional field: valid_to (ISO 8601 UTC or null)');
    }

    // session_id — mandatory for in-session records; null for consolidation-produced (§5.2)
    if (input.session_id !== undefined && input.session_id !== null &&
        !isNonEmptyString(input.session_id)) {
        errors.push('invalid optional field: session_id (string or null)');
    }

    // content — mandatory object with per-type required keys (§5.3)
    if (!isRecord(input.content)) {
        errors.push('missing mandatory field: content (object)');
    } else if (RECORD_TYPE_VALUES.includes(input.type as L2RecordType)) {
        const type = input.type as L2RecordType;
        for (const key of CONTENT_REQUIRED_KEYS[type]) {
            if (input.content[key] === undefined) {
                errors.push(`content missing required key for type "${type}": ${key} (§5.3)`);
            }
        }
    }

    if (errors.length > 0) {
        return { ok: false, errors };
    }

    const record: L2Record = {
        id: input.id as string,
        ts: input.ts as string,
        session_id: (input.session_id as string | null) ?? null,
        type: input.type as L2RecordType,
        provenance: input.provenance as L2Record['provenance'],
        importance: input.importance as number,
        valid_from: input.valid_from as string,
        valid_to: (input.valid_to as string | null) ?? null,
        content: input.content as RecordContent,
        source: input.source as L2Record['source'],
    };
    if (isRecord(input.meta)) {
        record.meta = input.meta as Record<string, unknown>;
    }
    return { ok: true, record, errors };
}

/** Required metadata keys per fact block (spec §6.2). */
const FACT_REQUIRED_KEYS: readonly string[] = [
    'statement',
    'provenance',
    'importance',
    'hot',
    'valid_from',
    'valid_to',
    'source',
    'supporting_observations',
    'observation_count',
    'last_observed',
    'status',
];

/**
 * Validate an L3 fact block's metadata against spec §6.2.
 * The fact `id`/`title` come from the block markers/heading, not the
 * metadata lines; they are validated separately by the core.md parser.
 */
export function validateFactBlockMetadata(
    meta: Record<string, unknown>,
): ValidationResult & { values?: Record<string, unknown> } {
    const errors: string[] = [];

    if (!isRecord(meta)) {
        return { ok: false, errors: ['fact block metadata must be an object'] };
    }

    for (const key of FACT_REQUIRED_KEYS) {
        // `valid_to` may legitimately be empty (= open, §6.2); all other
        // required keys must be present and non-empty.
        const missing = key === 'valid_to'
            ? meta[key] === undefined
            : meta[key] === undefined || meta[key] === null || meta[key] === '';
        if (missing) {
            errors.push(`fact block missing required key: ${key} (§6.2)`);
        }
    }

    if (meta.provenance !== undefined &&
        !PROVENANCE_VALUES.includes(meta.provenance as FactBlock['provenance'])) {
        errors.push(`invalid fact provenance (one of ${PROVENANCE_VALUES.join(', ')})`);
    }
    if (meta.importance !== undefined &&
        (typeof meta.importance !== 'number' || Number.isNaN(meta.importance) ||
            meta.importance < 0 || meta.importance > 1)) {
        errors.push('invalid fact importance (float in [0,1])');
    }
    if (meta.hot !== undefined && typeof meta.hot !== 'boolean') {
        errors.push('invalid fact hot (true/false)');
    }
    if (meta.valid_from !== undefined && !isIsoUtc(meta.valid_from)) {
        errors.push('invalid fact valid_from (ISO 8601 UTC)');
    }
    if (meta.valid_to !== undefined && meta.valid_to !== '' && !isIsoUtc(meta.valid_to)) {
        errors.push('invalid fact valid_to (ISO 8601 UTC or empty = open)');
    }
    if (meta.observation_count !== undefined &&
        (typeof meta.observation_count !== 'number' ||
            !Number.isInteger(meta.observation_count) || meta.observation_count < 0)) {
        errors.push('invalid fact observation_count (integer >= 0)');
    }
    if (meta.last_observed !== undefined && !isIsoUtc(meta.last_observed)) {
        errors.push('invalid fact last_observed (ISO 8601 UTC)');
    }
    if (meta.status !== undefined &&
        !FACT_STATUS_VALUES.includes(meta.status as FactBlock['status'])) {
        errors.push(`invalid fact status (one of ${FACT_STATUS_VALUES.join(', ')})`);
    }

    if (errors.length > 0) {
        return { ok: false, errors };
    }
    return { ok: true, values: meta as Record<string, unknown>, errors: [] };
}
