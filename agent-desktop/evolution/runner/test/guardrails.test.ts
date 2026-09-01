/**
 * T12 guardrail tests (TASK-9053 / Redmine #47).
 *
 * Verifies SEC-GEPA-01..11 measurable checks (metric + threshold +
 * how verified, T10 §5): size, suite fitness, regression, secrets,
 * supply-chain pinning, manifest schema. Every guardrail records
 * pass/fail for the audit trail (SEC-GEPA-11).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    auditTrailGuardrail,
    checkDepsPinned,
    costCapGuardrail,
    humanReviewGuardrail,
    isolationGuardrail,
    noAutoMergeGuardrail,
    noHotSwapGuardrail,
    regressionGuardrail,
    runGuardrails,
    secretsGuardrail,
    secretScanResult,
    sizeGuardrail,
    suiteGuardrail,
    supplyChainGuardrail,
    validateManifestSchema,
} from '../src/guardrails.js';

const SKILL_OK = '# Skill: install-dsh\n\n## Install\n1. Copy payload.\n2. Write config.\n';

test('SEC-GEPA-03: size guardrail — 15 KB limit enforced', () => {
    assert.equal(sizeGuardrail(100).pass, true);
    assert.equal(sizeGuardrail(15360).pass, true);
    assert.equal(sizeGuardrail(15361).pass, false);
    const r = sizeGuardrail(15361);
    assert.equal(r.id, 'SEC-GEPA-03');
    assert.ok(r.evidence.includes('re-measured by Node'));
});

test('SEC-GEPA-02: suite guardrail — 1.0 required', () => {
    assert.equal(suiteGuardrail(1.0, true).pass, true);
    assert.equal(suiteGuardrail(0.999, false).pass, false);
    assert.equal(suiteGuardrail(0.5, false).pass, false);
});

test('SEC-GEPA-04: regression guardrail — 0 regressions required', () => {
    assert.equal(regressionGuardrail({ pass: true, regressions: [] }).pass, true);
    const r = regressionGuardrail({ pass: false, regressions: [{ id: 'efs-detect-target' }] });
    assert.equal(r.pass, false);
    assert.equal(r.actual, 1);
});

test('SEC-GEPA-08: secret scan — 0 hits required (SEC-LOG-02)', () => {
    assert.equal(secretScanResult('no secrets here').pass, true);
    const hit = secretScanResult('key = DEEPSEEK_API_KEY set in env');
    assert.equal(hit.pass, false);
    assert.ok(hit.hits.length > 0);
    assert.equal(secretsGuardrail('OPENAI_API_KEY=sk-1234567890').pass, false);
    assert.equal(secretsGuardrail('clean text', 'clean dataset').pass, true);
});

test('SEC-GEPA-01/05/06/07: structural guardrails always pass (no merge/hot-swap paths)', () => {
    assert.equal(isolationGuardrail('/tmp/scratch').pass, true);
    assert.equal(noHotSwapGuardrail().pass, true);
    assert.equal(humanReviewGuardrail().pass, true);
    assert.equal(noAutoMergeGuardrail().pass, true);
});

test('SEC-GEPA-09: cost-cap guardrail records pause state', () => {
    const paused = costCapGuardrail(true);
    assert.equal(paused.pass, true);
    assert.ok(paused.actual.includes('paused'));
    assert.ok(paused.evidence.includes('unjudged'));
    assert.equal(costCapGuardrail(false).actual, 'judge gate ran');
});

test('SEC-GEPA-10: supply-chain pinning check on requirements.txt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gepa-pin-'));
    try {
        const pinned = join(dir, 'requirements.txt');
        writeFileSync(pinned, '# comment\ndspy==0.1.0\nrequests==2.31.0\n');
        const ok = checkDepsPinned(pinned);
        assert.equal(ok.pinned, true);
        assert.equal(ok.detail, '2 deps pinned by exact version');

        const unpinned = join(dir, 'requirements-unpinned.txt');
        writeFileSync(unpinned, 'dspy\nrequests>=2.0\n');
        const bad = checkDepsPinned(unpinned);
        assert.equal(bad.pinned, false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('SEC-GEPA-11: manifest schema validation', () => {
    const manifest = {
        manifest_version: '1.0',
        schema_version: 1,
        run_id: 'evo_t_1',
        job_id: 'evo_t_1',
        skill: 'install-dsh',
        dataset: { dataset_id: 'install-dsh-v0.1', sha256: 'a'.repeat(64), case_count: 24, path: '/x' },
        base_skill: { path: '/x/SKILL.md', sha256: 'b'.repeat(64), size_bytes: 2728 },
        sidecar: { version: '0.1.0', mode: 'subprocess', deps_pinned: true, sandbox_image: null, python: 'python3' },
        config: {},
        started_at: '2026-09-01T00:00:00.000Z',
        ended_at: '2026-09-01T00:00:01.000Z',
        status: 'completed',
        verdict: 'rejected',
        generations_run: 1,
        best_candidate_id: 'gen0-00',
        candidates: [],
        guardrails: {},
        judge_cost: { month: '2026-09', providers: {} },
        pr: { branch: null, url: null, note: 'no PR' },
    };
    assert.equal(validateManifestSchema(manifest).valid, true);

    const bad = { ...manifest, manifest_version: '9.9' };
    assert.equal(validateManifestSchema(bad).valid, false);
});

test('runGuardrails returns the full SEC-GEPA-01..11 checklist', () => {
    const results = runGuardrails({
        skillText: SKILL_OK,
        sizeBytes: 100,
        fitness: { fitness: 1.0, threshold_met: true, regression: { pass: true, regressions: [] } },
        judgePaused: false,
        sidecarDepsPinned: true,
        manifestValid: true,
    });
    const ids = results.map((r) => r.id);
    for (const id of ['SEC-GEPA-01', 'SEC-GEPA-02', 'SEC-GEPA-03', 'SEC-GEPA-04', 'SEC-GEPA-05',
        'SEC-GEPA-06', 'SEC-GEPA-07', 'SEC-GEPA-08', 'SEC-GEPA-09', 'SEC-GEPA-10', 'SEC-GEPA-11']) {
        assert.ok(ids.includes(id), `missing ${id}`);
    }
    for (const r of results) {
        assert.ok('metric' in r && 'threshold' in r && 'actual' in r && 'pass' in r && 'evidence' in r);
    }
    assert.equal(auditTrailGuardrail(true).pass, true);
    assert.equal(auditTrailGuardrail(false).pass, false);
});
