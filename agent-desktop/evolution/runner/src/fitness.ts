/**
 * Fitness gate (T12, ADR-016 / T09 §5) — consumes the T14 harness
 * contract exactly as shipped in PR #31:
 *
 *   - `lib/fitness.mjs` → `gate(result)` (SEC-GEPA-02 hard threshold 1.0)
 *   - `lib/runner.mjs` → `runSuite(behavior, {candidate})` (Mode A)
 *   - `lib/manifest.mjs` → `loadManifest()` / `validateManifest()`
 *   - result schema `schema/result.schema.json` (both modes)
 *
 * fitness(c) = (Σ w_i·pass_i) / (Σ w_i) ∈ [0,1] — computed by the
 * harness; this module adds:
 *   - SEC-GEPA-04 regression diff vs the base skill (A/B on the SAME
 *     suite; candidate pass set ⊇ base pass set ⇒ no regression);
 *   - schema-validity handling (a malformed result is a REJECT, never
 *     silently scored — harness `fitnessOfResult` semantics).
 *
 * The base skill is scored via the harness **reference behavior**
 * (`impl/reference.mjs`) — the base skill's executable proxy; every
 * candidate is scored via `buildBehaviorFromSkillText` (deterministic
 * extraction, `behavior.ts`).
 */

import { gate, fitnessOfResult } from '../../harness/lib/fitness.mjs';
import { runSuite } from '../../harness/lib/runner.mjs';
import { loadManifest } from '../../harness/lib/manifest.mjs';
import reference from '../../harness/impl/reference.mjs';
import { buildBehaviorFromSkillText } from './behavior.js';
import type { FitnessResult } from './types.js';

/** Score the BASE skill (reference behavior) — the regression anchor. */
export function scoreBaseSkill(opts: { runId?: string; startedAt?: string } = {}): ReturnType<typeof fitnessOfResult> & {
    result: ReturnType<typeof runSuite>;
    gate: ReturnType<typeof gate>;
} {
    const result = runSuite(reference, {
        candidate: { id: 'base', kind: 'base', path: null, size_bytes: null },
        runId: opts.runId ?? 'mode-a-base',
        startedAt: opts.startedAt,
    });
    return { ...fitnessOfResult(result), result, gate: gate(result) };
}

/**
 * Score a candidate SKILL.md text against the full suite (Mode A) and
 * compute the fitness verdict + SEC-GEPA-04 regression vs the base.
 */
export function evaluateCandidate(
    skillText: string,
    baseScore: ReturnType<typeof scoreBaseSkill>,
    opts: { candidateId?: string; runId?: string; startedAt?: string } = {},
): FitnessResult {
    const behavior = buildBehaviorFromSkillText(skillText);
    const result = runSuite(behavior, {
        candidate: {
            id: opts.candidateId ?? 'candidate',
            kind: 'candidate',
            path: null,
            size_bytes: Buffer.byteLength(skillText, 'utf8'),
        },
        runId: opts.runId ?? `mode-a-${opts.candidateId ?? 'candidate'}`,
        startedAt: opts.startedAt,
    });

    const scored = fitnessOfResult(result);
    const verdict = gate(result);

    // SEC-GEPA-04: candidate pass set ⊇ base pass set (same suite).
    const basePassIds = new Set(
        baseScore.result.cases.filter((c) => c.status === 'pass').map((c) => c.id),
    );
    const regressions: Array<{ id: string; scenario: string; base: string; candidate: string }> = [];
    for (const c of result.cases) {
        if (basePassIds.has(c.id) && c.status !== 'pass') {
            regressions.push({
                id: c.id,
                scenario: c.scenario,
                base: 'pass',
                candidate: c.status,
            });
        }
    }

    return {
        fitness: scored.valid ? scored.fitness : 0,
        threshold_met: scored.valid && verdict.gate === 'PASS',
        passed: scored.valid ? scored.details?.passed ?? 0 : 0,
        total: scored.valid ? scored.details?.total ?? 0 : 0,
        failures: scored.valid ? (scored.details?.failures ?? []) : [{ id: 'schema', scenario: '', status: 'error' }],
        regression: {
            base_passed: basePassIds.size,
            candidate_passed: result.cases.filter((c) => c.status === 'pass').length,
            regressions,
            pass: regressions.length === 0,
        },
        valid: scored.valid,
        errors: scored.valid ? [] : (scored.errors ?? []),
    };
}

/** Load the harness manifest (scenario classes + case metadata). */
export function loadHarnessManifest() {
    return loadManifest();
}
