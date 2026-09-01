/**
 * Shared T12 runner types (evolution/runner) — mirror the JSON-RPC
 * contract and candidate contract of T09 §4.3/§4.4.
 */

/** Candidate notification emitted by the sidecar (T09 §4.4). */
export interface CandidateNotification {
    candidate_id: string;
    generation: number;
    skill_text: string;
    size_bytes: number;
    self_fitness: number | null;
    self_guardrails: Record<string, unknown>;
    reflection: { context: string; error: string; fix: string } | null;
}

/** `evolve` response — final run report (T09 §4.3). */
export interface EvolutionReport {
    job_id: string;
    status: 'ok' | 'cancelled' | 'error';
    generations_run: number;
    best_candidate_id: string | null;
    started_at: string;
    ended_at: string;
    sidecar_version: string;
    candidate_count: number;
    lm_fallback_note?: string | null;
}

/** One guardrail outcome (metric + threshold + how verified, T10 §5). */
export interface GuardrailResult {
    /** Guardrail id, e.g. `SEC-GEPA-03`. */
    id: string;
    /** What is measured. */
    metric: string;
    /** The pass value. */
    threshold: string | number | boolean;
    /** Measured value. */
    actual: string | number | boolean | null;
    /** Pass/fail. */
    pass: boolean;
    /** Evidence reference for the audit trail. */
    evidence: string;
}

/** Fitness result of a candidate on the harness (T09 §5.2, ADR-016). */
export interface FitnessResult {
    fitness: number;
    threshold_met: boolean;
    passed: number;
    total: number;
    failures: Array<{ id: string; scenario: string; status: string }>;
    /** SEC-GEPA-04 regression diff vs base skill. */
    regression: {
        base_passed: number;
        candidate_passed: number;
        regressions: Array<{ id: string; scenario: string; base: string; candidate: string }>;
        pass: boolean;
    };
    /** Harness result schema validation. */
    valid: boolean;
    errors: string[];
}

/** A judge verdict (spec §9.3 — reused shape). */
export interface JudgeVerdict {
    verdict: 'approve' | 'reject' | 'revise';
    confidence: number;
    reasons: string[];
    suggested_edit: string | null;
}

/** Outcome of the GEPA judge gate for one candidate. */
export interface JudgeGateOutcome {
    gate: 'approve' | 'reject' | 'error' | 'paused' | 'skipped';
    per_model: Record<string, string>;
    verdicts: Record<string, JudgeVerdict>;
    disabled_models: string[];
    skipped_models: string[];
    reasons: string[];
    reason: string | null;
    /** Cost snapshot after the call (SEC-GEPA-09). */
    cost: { month: string; providers: Record<string, { spentUsd: number; capUsd: number; disabled: boolean }> };
}
