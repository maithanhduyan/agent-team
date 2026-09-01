/**
 * T14 harness selfcheck — certifies the harness itself so CI can gate
 * on it (Mode A, offline):
 *
 *  1. manifest validates against schema + COV-1 coverage (every class
 *     has >= min_cases cases; every case in exactly one class);
 *  2. result JSON validates against the result schema;
 *  3. fitness function math (ADR-016) is correct, incl. weights;
 *  4. reference behavior (base skill) passes 12/12 → gate 1.0
 *     (SEC-GEPA-02 / T10 §5);
 *  5. planted-failure mutants are DETECTED by the suite (each mutant
 *     fails exactly its scenario class);
 *  6. determinism: two reference runs produce identical per-case
 *     statuses.
 *
 * Run:  node --test evolution/harness/tests/harness-selfcheck.test.mjs
 *       (or `node mode-a/run-mode-a.mjs --verify-planted`)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadManifest, validateManifest, MANIFEST_PATH, RESULT_SCHEMA_PATH } from '../lib/manifest.mjs';
import { validate } from '../lib/validate.mjs';
import { fitnessOfCases, gate } from '../lib/fitness.mjs';
import { runSuite } from '../lib/runner.mjs';
import referenceBehavior from '../impl/reference.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

async function loadBehavior(id) {
  const mod = await import(`../impl/${id === 'reference' ? 'reference' : `mutants/${id}`}.mjs`);
  return mod.default;
}

const ALL_IDS = () => loadManifest().cases.map((c) => c.id);

// ------------------------------------------------------------- 1. manifest
test('manifest validates against schema/manifest.schema.json', () => {
  const manifest = loadManifest();
  const schema = JSON.parse(readFileSync(join(ROOT, 'schema/manifest.schema.json'), 'utf8'));
  const { valid, errors } = validate(manifest, schema);
  assert.ok(valid, `manifest schema errors: ${errors.join('; ')}`);
});

test('manifest coverage (COV-1): every declared class has >= min_cases cases; every case in exactly one class', () => {
  const mv = validateManifest();
  assert.ok(mv.valid, `manifest coverage errors: ${mv.errors.join('; ')}`);
  // 4 scenario classes with 3 cases each
  assert.equal(mv.classes.length, 4);
  assert.deepEqual(
    Object.keys(mv.casesByClass).sort(),
    ['efs', 'happy-path', 'junction', 'service-password'],
  );
  for (const cls of mv.classes) {
    assert.ok(mv.casesByClass[cls.id].length >= cls.min_cases,
      `class ${cls.id}: ${mv.casesByClass[cls.id].length} < min ${cls.min_cases}`);
  }
});

// ------------------------------------------------------------- 2. result schema
test('reference run result validates against schema/result.schema.json', async () => {
  const behavior = await loadBehavior('reference');
  const result = runSuite(behavior, { runId: 'selfcheck-reference' });
  const schema = JSON.parse(readFileSync(join(ROOT, 'schema/result.schema.json'), 'utf8'));
  const { valid, errors } = validate(result, schema);
  assert.ok(valid, `result schema errors: ${errors.join('; ')}`);
});

// ------------------------------------------------------------- 3. fitness math
test('fitness(c) = Σ w_i·pass_i / Σ w_i (ADR-016) with uniform weights', () => {
  const cases = [
    { id: 'a', status: 'pass', weight: 1 },
    { id: 'b', status: 'fail', weight: 1 },
    { id: 'c', status: 'pass', weight: 1 },
    { id: 'd', status: 'pass', weight: 1 },
  ];
  const f = fitnessOfCases(cases);
  assert.equal(f.fitness, 0.75);
  assert.equal(f.passed, 3);
  assert.equal(f.failed, 1);
});

test('weights affect the score (ranking only; threshold is still 1.0)', () => {
  const cases = [
    { id: 'a', status: 'pass', weight: 1 },
    { id: 'b', status: 'fail', weight: 0.5 },
  ];
  const f = fitnessOfCases(cases);
  assert.ok(Math.abs(f.fitness - (1 / 1.5)) < 1e-9);
  // acceptance threshold independent of weights
  const allPass = fitnessOfCases([{ id: 'x', status: 'pass', weight: 0.1 }]);
  assert.equal(allPass.fitness, 1);
});

test('gate: 100% pass -> PASS; any non-pass -> REJECT (SEC-GEPA-02)', () => {
  const baseCases = ALL_IDS().map((id) => ({ id, scenario: 'happy-path', status: 'pass', weight: 1, captured_output: [] }));
  const makeResult = (cases) => ({
    schema_version: '1.0', harness_version: '1.0.0', manifest_version: '1.0.0',
    mode: 'A', run_id: 'x', skill: 'install-dsh', candidate: null,
    started_at: new Date().toISOString(), ended_at: new Date().toISOString(),
    cases,
    summary: {
      total: cases.length,
      passed: cases.filter((c) => c.status === 'pass').length,
      failed: cases.filter((c) => c.status === 'fail').length,
      skipped: cases.filter((c) => c.status === 'skip').length,
      errors: cases.filter((c) => c.status === 'error').length,
      fitness: cases.filter((c) => c.status === 'pass').length / cases.length,
      threshold_met: cases.every((c) => c.status === 'pass'),
    },
  });
  assert.equal(gate(makeResult(baseCases)).gate, 'PASS');
  const bad = makeResult(baseCases.map((c, i) => (i === 0 ? { ...c, status: 'fail' } : c)));
  assert.equal(gate(bad).gate, 'REJECT');
  const skip = makeResult(baseCases.map((c, i) => (i === 0 ? { ...c, status: 'skip' } : c)));
  assert.equal(gate(skip).gate, 'REJECT');
});

// ------------------------------------------------------------- 4. reference behavior
test('reference (base skill) passes all cases -> fitness 1.0', async () => {
  const behavior = await loadBehavior('reference');
  const result = runSuite(behavior, { runId: 'selfcheck-reference' });
  assert.equal(result.summary.total, 12);
  assert.equal(result.summary.passed, 12);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.summary.fitness, 1);
  assert.equal(result.summary.threshold_met, true);
});

// ------------------------------------------------------------- 5. planted detection
test('planted-failure mutants are detected (each fails its scenario class)', async () => {
  const expectations = {
    'efs-ignore': ['efs-detect-target', 'efs-copy-source', 'efs-cleanup-encrypted'],
    'junction-naive': ['jct-resolve', 'jct-traverse', 'jct-cleanup'],
    'svc-no-restart': ['svc-restart', 'svc-failure-safe'],
  };
  for (const [mutant, failIds] of Object.entries(expectations)) {
    const behavior = await loadBehavior(mutant);
    const result = runSuite(behavior, { runId: `selfcheck-${mutant}` });
    const failed = result.cases.filter((c) => c.status !== 'pass').map((c) => c.id).sort();
    assert.deepEqual(failed, [...failIds].sort(), `mutant ${mutant} failures`);
    // non-target classes stay green (no cross-class regression in the suite)
    const other = result.cases.filter((c) => !failIds.includes(c.id));
    assert.ok(other.every((c) => c.status === 'pass'), `mutant ${mutant} leaked failures into other classes`);
  }
});

// ------------------------------------------------------------- 6. determinism
test('deterministic: two reference runs produce identical per-case statuses', () => {
  const a = runSuite({ ...referenceBehavior }, { runId: 'det-1' });
  const b = runSuite({ ...referenceBehavior }, { runId: 'det-2' });
  assert.deepEqual(
    a.cases.map((c) => [c.id, c.status]),
    b.cases.map((c) => [c.id, c.status]),
  );
});
