/**
 * Deterministic verifier — anti-hallucinated writes (spec §10.5).
 *
 * Runs after the judge gate and before any L3/L4 write:
 * 1. **Citation check (§10.5.1):** every supporting observation id must
 *    exist in L2 and its content must be compatible with the candidate
 *    statement (token-overlap sanity check; threshold
 *    `MEMORY_VERIFY_MIN_OVERLAP`, default 0.3). Overlap is defined as
 *    the fraction of candidate tokens present in the observation —
 *    "how much of the statement is supported by this record" — which is
 *    deterministic and hand-computable for T06.
 * 2. **Provenance chain check (§10.5.2):** a candidate supported ONLY by
 *    `model_inferred` observations is rejected unless the judge approved
 *    with high confidence (≥ 0.8) — R-PROV-4/§10.5.2.
 * 3. **Conflict check (§10.5.3):** the candidate must not contradict an
 *    active fact unless a `supersede` is explicitly approved.
 * 4. **Injection re-scan (§10.5.4):** the final text is re-scanned for
 *    injection patterns (§10.2.2) — quarantine-level content never
 *    reaches L3/L4.
 *
 * Any failure → candidate rejected (`rejection` record with reason).
 */

import { DEFAULT_INJECTION_PATTERNS, scanForInjection } from './injection.js';
import { tokenize } from './retrieval.js';
import { factStatement } from './judge.js';
import type { CandidateInput, FactLike, JudgeGateResult } from './judge.js';
import type { L2Record } from './types.js';

/** Default conflict-overlap threshold (§10.3 — ADR-013 internal knob). */
export const DEFAULT_CONFLICT_OVERLAP = 0.5;

/** Token-overlap of a statement against an observation: |Q ∩ D| / |Q|. */
export function statementOverlap(statement: string, observationText: string): number {
    const q = tokenize(statement);
    if (q.length === 0) {
        return 0;
    }
    const d = new Set(tokenize(observationText));
    const common = q.filter((t) => d.has(t)).length;
    return common / q.length;
}

/**
 * Active facts that "contradict" the candidate: same topic (statement
 * overlap ≥ threshold) but different content. Used by the consolidation
 * job to route a graduation into the supersede flow (§10.3) and by the
 * verifier's conflict check (§10.5.3).
 */
export function findConflictingFacts(
    candidate: CandidateInput,
    activeFacts: readonly FactLike[],
    threshold = DEFAULT_CONFLICT_OVERLAP,
): FactLike[] {
    return activeFacts.filter((fact) => {
        const overlap = statementOverlap(candidate.text, factStatement(fact));
        return overlap >= threshold;
    });
}

/** Judge outcome shape the verifier needs (§10.5.2 high-confidence rule). */
export interface VerifierJudge {
    verdict: 'approve' | 'reject' | 'revise';
    confidence: number;
}

export interface VerifierInput {
    candidate: CandidateInput;
    /** Resolved supporting observations by id (citation check). */
    observations: Record<string, L2Record> | Map<string, L2Record>;
    /** Active facts from core.md (conflict check). */
    activeFacts: readonly FactLike[];
    /** Judge outcome (provenance-chain high-confidence rule). */
    judge: VerifierJudge | JudgeGateResult;
    /** True when a supersede of a conflicting fact was explicitly approved (§10.5.3). */
    supersedeApproved?: boolean;
    /** Citation overlap threshold (default 0.3, §10.5.1). */
    minOverlap?: number;
    /** Conflict-overlap threshold (default 0.5, ADR-013). */
    conflictOverlap?: number;
    /** Injection patterns for the re-scan (default shipped defaults). */
    injectionPatterns?: readonly string[];
}

export interface VerifierResult {
    ok: boolean;
    /** Failure reasons (empty when ok). */
    reasons: string[];
}

function getObservation(
    observations: Record<string, L2Record> | Map<string, L2Record>,
    id: string,
): L2Record | undefined {
    if (observations instanceof Map) {
        return observations.get(id);
    }
    return observations[id];
}

/** Run the deterministic verifier (spec §10.5). Returns ok + reasons. */
export function verifyCandidate(input: VerifierInput): VerifierResult {
    const reasons: string[] = [];
    const minOverlap = input.minOverlap ?? 0.3;
    const conflictOverlap = input.conflictOverlap ?? DEFAULT_CONFLICT_OVERLAP;
    const patterns = input.injectionPatterns ?? DEFAULT_INJECTION_PATTERNS;
    const judge = input.judge;

    // 1. Citation check (§10.5.1).
    const missing: string[] = [];
    const lowOverlap: string[] = [];
    for (const id of input.candidate.supporting_ids) {
        const record = getObservation(input.observations, id);
        if (!record) {
            missing.push(id);
            continue;
        }
        const text = recordTextOf(record);
        if (text === '') {
            lowOverlap.push(id);
            continue;
        }
        const overlap = statementOverlap(input.candidate.text, text);
        if (overlap < minOverlap) {
            lowOverlap.push(`${id} (overlap ${overlap.toFixed(3)} < ${minOverlap})`);
        }
    }
    if (missing.length > 0) {
        reasons.push(`citation check failed: supporting observation(s) not found in L2: ${missing.join(', ')}`);
    }
    if (lowOverlap.length > 0) {
        reasons.push(`citation check failed: supporting observation(s) do not support the statement (overlap < ${minOverlap}): ${lowOverlap.join(', ')}`);
    }

    // 2. Provenance chain check (§10.5.2 / R-PROV-4): model_inferred-only
    //    candidates need judge approval with confidence >= 0.8.
    const supportingRecords = input.candidate.supporting_ids
        .map((id) => getObservation(input.observations, id))
        .filter((r): r is L2Record => r !== undefined);
    const onlyInferred = supportingRecords.length > 0 &&
        supportingRecords.every((r) => r.provenance === 'model_inferred');
    if (onlyInferred) {
        const { verdict, confidence } = judgeVerdictAndConfidence(judge);
        if (verdict !== 'approve' || confidence === undefined || confidence < 0.8) {
            reasons.push(
                'provenance chain check failed: model_inferred-only candidate requires judge approval with confidence >= 0.8 (R-PROV-4, §10.5.2)',
            );
        }
    }

    // 3. Conflict check (§10.5.3): contradicts an active fact without an
    //    explicitly approved supersede → reject.
    const conflicting = findConflictingFacts(input.candidate, input.activeFacts, conflictOverlap);
    if (conflicting.length > 0 && !input.supersedeApproved) {
        reasons.push(
            `conflict check failed: candidate contradicts active fact(s) ${conflicting.map((f) => f.id).join(', ')} without an approved supersede (§10.5.3)`,
        );
    }

    // 4. Injection re-scan (§10.5.4 / §10.2.2).
    const scan = scanForInjection({ content: input.candidate.text }, patterns);
    if (scan.matched) {
        reasons.push(`injection re-scan failed: matched pattern "${scan.pattern}" (§10.5.4)`);
    }

    return { ok: reasons.length === 0, reasons };
}

/** Extract the judge verdict + confidence from either input shape. */
function judgeVerdictAndConfidence(judge: VerifierJudge | JudgeGateResult): { verdict: VerifierJudge['verdict']; confidence: number | undefined } {
    if ('verdict' in judge) {
        return { verdict: judge.verdict, confidence: judge.confidence };
    }
    const gate = judge as JudgeGateResult;
    const verdict: VerifierJudge['verdict'] = gate.gate === 'approve' ? 'approve' : gate.gate === 'reject' ? 'reject' : 'revise';
    let confidence: number | undefined;
    for (const v of Object.values(gate.verdicts ?? {})) {
        if (v.verdict === 'approve') {
            confidence = Math.max(confidence ?? 0, v.confidence);
        }
    }
    return { verdict, confidence };
}

/** Extract the searchable text of a supporting L2 record. */
function recordTextOf(record: L2Record): string {
    const content = record.content as Record<string, unknown>;
    if (typeof content.text === 'string') {
        return content.text;
    }
    return '';
}
