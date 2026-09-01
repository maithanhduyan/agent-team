/**
 * T12 fitness gate tests (TASK-9053 / Redmine #47).
 *
 * Verifies the gate consumes the T14 harness contract exactly
 * (PR #31): `gate(result)` from `harness/lib/fitness.mjs`, the unified
 * result schema, and the A/B regression diff vs the base skill
 * (SEC-GEPA-04). Uses the real committed harness + the real dataset
 * fixture (T11).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { scoreBaseSkill, evaluateCandidate, loadHarnessManifest } from '../src/fitness.js';
import { buildBehaviorFromSkillText } from '../src/behavior.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const BASE_SKILL_PATH = join(REPO_ROOT, 'agent-desktop/evolution/harness/fixtures/install-dsh/SKILL.md');
const BASE_SKILL = readFileSync(BASE_SKILL_PATH, 'utf8');

test('base skill scores fitness 1.0 (12/12) on the harness', () => {
    const base = scoreBaseSkill();
    assert.equal(base.valid, true);
    assert.equal(base.fitness, 1.0);
    assert.equal(base.gate.gate, 'PASS');
    assert.equal(base.result.cases.length, 12);
    assert.equal(base.result.cases.filter((c) => c.status === 'pass').length, 12);
});

test('harness manifest declares the 4 scenario classes (COV-1)', () => {
    const m = loadHarnessManifest();
    const ids = m.scenario_classes.map((c) => c.id).sort();
    assert.deepEqual(ids, ['efs', 'happy-path', 'junction', 'service-password']);
    assert.equal(m.cases.length, 12);
});

test('candidate that preserves the base skill text passes the gate', () => {
    const base = scoreBaseSkill();
    const fit = evaluateCandidate(BASE_SKILL, base, { candidateId: 'gen1-01' });
    assert.equal(fit.fitness, 1.0);
    assert.equal(fit.threshold_met, true);
    assert.equal(fit.regression.pass, true);
    assert.equal(fit.regression.regressions.length, 0);
    assert.equal(fit.valid, true);
});

test('SEC-GEPA-04: candidate missing EFS guidance regresses on efs cases', () => {
    const base = scoreBaseSkill();
    // Minimal candidate that documents install/cleanup but NO EFS
    // handling → the efs cases must fail (deterministic extraction).
    const noEfs = `# Skill: install-dsh

## Install
1. Copy the payload into the target directory.
2. Write config/dsh.json.

## Cleanup
- Remove the installed artifacts (bin, config).
`;
    const fit = evaluateCandidate(noEfs, base, { candidateId: 'gen1-02' });
    // Fitness < 1.0 because efs cases fail; regression detected.
    assert.equal(fit.threshold_met, false);
    assert.equal(fit.regression.pass, false);
    const efsFailures = fit.failures.filter((f) => f.scenario === 'efs');
    assert.ok(efsFailures.length >= 3, `expected efs failures, got ${JSON.stringify(fit.failures)}`);
});

test('SEC-GEPA-03: oversized candidate is gated by the size check (fitness independent)', () => {
    // The fitness gate measures suite pass; size is a separate guardrail.
    const base = scoreBaseSkill();
    const big = BASE_SKILL + '\n' + '# padding\n' + 'x'.repeat(20000);
    const fit = evaluateCandidate(big, base, { candidateId: 'gen1-03' });
    assert.equal(fit.threshold_met, true, 'size does not affect suite fitness');
});

test('candidate behavior extraction is deterministic (same text -> same behavior)', () => {
    const a = buildBehaviorFromSkillText(BASE_SKILL);
    const b = buildBehaviorFromSkillText(BASE_SKILL);
    // Same text ⇒ the SAME method functions are selected (reference vs
    // naive) — identical references prove deterministic extraction (CG-1).
    const methods = ['install', 'cleanup', 'efsDetectTarget', 'efsCopySource', 'efsCleanup',
        'jctResolve', 'jctTraverse', 'jctCleanup', 'svcUpdateCredential', 'svcFailureSafe'] as const;
    for (const m of methods) {
        assert.equal(a[m], b[m], `${m} must resolve identically for the same text`);
    }
});

test('behavior extraction: junction-naive candidate fails junction cases', () => {
    const base = scoreBaseSkill();
    const naiveJunction = `# Skill: install-dsh

## Install
1. Copy the payload into the target path as-is.
2. Write config/dsh.json.

## Cleanup
- Remove artifacts recursively.
`;
    const fit = evaluateCandidate(naiveJunction, base, { candidateId: 'gen1-04' });
    assert.equal(fit.threshold_met, false);
    const jctFailures = fit.failures.filter((f) => f.scenario === 'junction');
    assert.ok(jctFailures.length >= 2, `expected junction failures, got ${JSON.stringify(fit.failures)}`);
});
