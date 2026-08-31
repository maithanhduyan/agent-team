/**
 * T06 schema oracle — validates records/facts/verdicts against the
 * contracts of docs/memory-spec.md (§5.2/§5.3, §6.2, §9.3).
 *
 * Test-oracle code only: it encodes the spec's REQUIRED keys so the
 * fixture selfcheck can certify the fixtures and, once T03/T04/T05 land,
 * the same functions certify implementation output.
 */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const PROVENANCE = ['user_stated', 'model_inferred', 'tool_output'];
const SOURCE_KINDS = ['user', 'tool', 'model', 'bridge'];

export const RECORD_TYPES = [
  'session_start', 'session_end', 'observation', 'tool_call', 'reflection',
  'candidate', 'graduation', 'rejection', 'supersede', 'decay',
  'hot_promote', 'hot_demote', 'quarantine', 'error',
];

/** Required `content` keys per record type (spec §5.3). */
export const CONTENT_REQUIRED = {
  session_start: ['channel', 'summary'],
  session_end: ['reason', 'duration_s'],
  observation: ['text', 'kind'],
  tool_call: ['tool', 'args', 'ok'],
  reflection: ['context', 'error', 'fix'],
  candidate: ['tier', 'text', 'supporting_ids'],
  graduation: ['tier', 'fact_id', 'judge', 'verdict'],
  rejection: ['tier', 'text', 'judge', 'verdict', 'reason'],
  supersede: ['old_id', 'new_id', 'reason'],
  decay: ['fact_id', 'importance_before', 'importance_after', 'reason'],
  hot_promote: ['fact_id', 'importance'],
  hot_demote: ['fact_id', 'importance'],
  quarantine: ['reason', 'text', 'snippet'],
  error: ['code', 'message'],
};

/**
 * Types whose provenance is fixed by the spec: reflections are
 * model_inferred "by definition" (§8.3), candidates are produced by the
 * model (§8.2 stage 3).
 */
export const TYPE_PROVENANCE = {
  reflection: ['model_inferred'],
  candidate: ['model_inferred'],
};

function isIso(s) {
  return typeof s === 'string' && ISO_RE.test(s) && !Number.isNaN(Date.parse(s));
}

export function validateRecord(rec) {
  const errors = [];
  if (typeof rec?.id !== 'string' || rec.id === '') errors.push('id: required non-empty string');
  if (!isIso(rec?.ts)) errors.push('ts: required ISO 8601 UTC');
  if (typeof rec?.type !== 'string' || rec.type === '') errors.push('type: required string');
  if (!PROVENANCE.includes(rec?.provenance)) {
    errors.push(`provenance: required one of ${PROVENANCE.join('|')}`);
  } else if (TYPE_PROVENANCE[rec.type] && !TYPE_PROVENANCE[rec.type].includes(rec.provenance)) {
    errors.push(`provenance: type ${rec.type} requires ${TYPE_PROVENANCE[rec.type].join('|')} (spec §8.3)`);
  }
  if (typeof rec?.importance !== 'number' || rec.importance < 0 || rec.importance > 1) {
    errors.push('importance: required float in [0,1]');
  }
  if (!isIso(rec?.valid_from)) errors.push('valid_from: required ISO 8601 UTC');
  if (rec?.valid_to !== null && rec?.valid_to !== undefined && !isIso(rec.valid_to)) {
    errors.push('valid_to: ISO 8601 UTC or null');
  }
  if (rec?.session_id !== null && rec?.session_id !== undefined && typeof rec.session_id !== 'string') {
    errors.push('session_id: string or null');
  }
  const src = rec?.source;
  if (typeof src !== 'object' || src === null) {
    errors.push('source: required object');
  } else {
    if (!SOURCE_KINDS.includes(src.kind)) errors.push(`source.kind: required one of ${SOURCE_KINDS.join('|')}`);
    if (typeof src.ref !== 'string' || src.ref === '') errors.push('source.ref: required non-empty string');
  }
  if (typeof rec?.content !== 'object' || rec.content === null) {
    errors.push('content: required object');
  } else if (RECORD_TYPES.includes(rec.type)) {
    for (const k of CONTENT_REQUIRED[rec.type] ?? []) {
      if (!(k in rec.content)) errors.push(`content.${k}: required for type ${rec.type}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export const FACT_REQUIRED_KEYS = [
  'statement', 'provenance', 'importance', 'hot', 'valid_from', 'valid_to',
  'source', 'supporting_observations', 'observation_count', 'last_observed', 'status',
];

export const FACT_STATUS = ['active', 'superseded', 'expired', 'stale'];

export function validateFactBlock(block) {
  const errors = [];
  for (const k of FACT_REQUIRED_KEYS) {
    if (!(k in block)) errors.push(`${k}: required key missing`);
  }
  if (!PROVENANCE.includes(block?.provenance)) errors.push('provenance: invalid tag');
  const imp = Number(block?.importance);
  if (!Number.isFinite(imp) || imp < 0 || imp > 1) errors.push('importance: float in [0,1]');
  if (block?.hot !== 'true' && block?.hot !== 'false') errors.push('hot: "true"|"false"');
  if (!isIso(block?.valid_from)) errors.push('valid_from: ISO 8601 UTC');
  if (block?.valid_to !== '' && block?.valid_to !== undefined && !isIso(block.valid_to)) {
    errors.push('valid_to: ISO 8601 UTC or empty');
  }
  if (!FACT_STATUS.includes(block?.status)) errors.push(`status: one of ${FACT_STATUS.join('|')}`);
  const oc = Number(block?.observation_count);
  if (!Number.isInteger(oc) || oc < 0) errors.push('observation_count: int >= 0');
  if (!isIso(block?.last_observed)) errors.push('last_observed: ISO 8601 UTC');
  return { valid: errors.length === 0, errors };
}

export function validateVerdict(payload) {
  if (typeof payload !== 'object' || payload === null) return { valid: false, error: 'not-json-object' };
  const { verdict, confidence, reasons, suggested_edit } = payload;
  if (!['approve', 'reject', 'revise'].includes(verdict)) return { valid: false, error: 'unknown-or-missing-verdict' };
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    return { valid: false, error: 'confidence-out-of-range' };
  }
  if (!Array.isArray(reasons) || reasons.length < 1 || !reasons.every((r) => typeof r === 'string')) {
    return { valid: false, error: 'reasons-required-nonempty-strings' };
  }
  if (verdict === 'revise' && (typeof suggested_edit !== 'string' || suggested_edit === '')) {
    return { valid: false, error: 'revise-requires-suggested_edit' };
  }
  return { valid: true, error: null };
}
