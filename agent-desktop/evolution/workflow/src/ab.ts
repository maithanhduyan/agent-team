/**
 * SEC-GEPA-04 semantic-preservation — A/B regression check (T13 re-check).
 *
 * Candidate pass set ⊇ base pass set on the SAME pinned dataset;
 * candidate fitness ≥ base fitness; 0 regressions ⇒ pass, any regression
 * ⇒ reject (T10 §5 SEC-GEPA-04, T10 §7.2 R-4).
 *
 * This re-runs the T12 fitness machinery (`runner/src/fitness.ts`) on the
 * candidate text — deterministic (CG-1), so the check is re-runnable from
 * the audit trail alone (SEC-GEPA-11 replay).
 */

import { readFileSync } from 'node:fs';
import { scoreBaseSkill, evaluateCandidate } from '../../runner/src/fitness.js';

export interface AbRegressionResult {
    valid: boolean;
    fitness: number;
    passed: number;
    total: number;
    threshold_met: boolean;
    base_passed: number;
    candidate_passed: number;
    regressions: Array<{ id: string; scenario: string; base: string; candidate: string }>;
    pass: boolean;
    evidence: string;
}

/**
 * A/B run base vs candidate on the same suite (T10 §5 SEC-GEPA-04):
 * returns the regression diff; `pass` iff 0 regressions AND fitness ≥
 * the base fitness (base is 1.0 on the reference suite, so fitness must
 * stay 1.0).
 */
export function abRegression(skillText: string): AbRegressionResult {
    const baseScore = scoreBaseSkill({ runId: 't13-ab-base' });
    const candidate = evaluateCandidate(skillText, baseScore, {
        candidateId: 't13-ab-candidate',
        runId: 't13-ab-candidate',
    });

    const regressions = candidate.regression.regressions;
    const pass =
        candidate.valid &&
        candidate.threshold_met &&
        candidate.regression.pass &&
        regressions.length === 0;

    return {
        valid: candidate.valid,
        fitness: candidate.fitness,
        passed: candidate.passed,
        total: candidate.total,
        threshold_met: candidate.threshold_met,
        base_passed: candidate.regression.base_passed,
        candidate_passed: candidate.regression.candidate_passed,
        regressions,
        pass,
        evidence:
            `A/B base (reference behavior) vs candidate on the SAME T14 suite; ` +
            `base_passed=${candidate.regression.base_passed}, candidate_passed=${candidate.regression.candidate_passed}, ` +
            `regressions=${regressions.length} — 0 regressions required (SEC-GEPA-04)`,
    };
}

/**
 * CLI entry: `... ab <candidate-skill.md>` — exits 0 (0 regressions) or
 * 1 (reject, R-4).
 */
export function abCli(skillFilePath: string): number {
    const text = readFileSync(skillFilePath, 'utf8');
    const r = abRegression(text);
    // eslint-disable-next-line no-console
    console.log(
        `SEC-GEPA-04 A/B: fitness=${r.fitness} (${r.passed}/${r.total}) regressions=${r.regressions.length} → ${
            r.pass ? 'PASS' : 'REJECT'
        }`,
    );
    if (!r.pass && r.regressions.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`regressions: ${JSON.stringify(r.regressions, null, 2)}`);
    }
    return r.pass ? 0 : 1;
}
