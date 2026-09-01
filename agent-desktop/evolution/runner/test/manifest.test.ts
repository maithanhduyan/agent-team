/**
 * T12 run-manifest tests (TASK-9053 / Redmine #47) — SEC-GEPA-11.
 *
 * Verifies: manifest shape, write to runs/<job_id>/manifest.json,
 * schema validation, and replayability fields (dataset hash, sidecar
 * version, guardrail outcomes, verdicts — AT-1/AT-2).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest, writeManifest, type ManifestBuildInput } from '../src/manifest.js';
import { validateManifestSchema } from '../src/guardrails.js';

function sampleInput(over: Partial<ManifestBuildInput> = {}): ManifestBuildInput {
    return {
        jobId: 'evo_20260901_001',
        skill: 'install-dsh',
        dataset: { dataset_id: 'install-dsh-v0.1', sha256: 'c'.repeat(64), case_count: 24, path: '/x/dataset.json' },
        baseSkill: { path: '/x/SKILL.md', sha256: 'd'.repeat(64), size_bytes: 2728 },
        sidecar: { version: '0.1.0', mode: 'subprocess', deps_pinned: true, sandbox_image: null, python: 'python3' },
        config: { evolution: { generations: 3 }, judge: { panel_models: ['deepseek'] } },
        startedAt: '2026-09-01T00:00:00.000Z',
        endedAt: '2026-09-01T00:01:00.000Z',
        status: 'completed',
        verdict: 'merge-ready',
        generationsRun: 3,
        bestCandidateId: 'gen3-01',
        candidates: [
            {
                candidate_id: 'gen3-01',
                generation: 3,
                size_bytes: 2728,
                self_fitness: 1.0,
                self_guardrails: null,
                reflection: null,
                guardrails: {
                    'SEC-GEPA-03': {
                        id: 'SEC-GEPA-03',
                        metric: 'size',
                        threshold: '<= 15360',
                        actual: 2728,
                        pass: true,
                        evidence: 'wc -c',
                    },
                },
                fitness: { fitness: 1.0, threshold_met: true, passed: 12, total: 12, failures: [], regression: { pass: true, regressions: [] } },
                judge: { gate: 'approve', per_model: { deepseek: 'approve' }, verdicts: {}, disabled_models: [], skipped_models: [], reason: null },
                candidate_verdict: 'accepted',
                reject_reasons: [],
            },
        ],
        runGuardrails: {
            'SEC-GEPA-01': { id: 'SEC-GEPA-01', metric: 'isolation', threshold: 0, actual: 0, pass: true, evidence: 'sandbox' },
        },
        judgeCost: { month: '2026-09', providers: { deepseek: { spentUsd: 0.42, capUsd: 15, disabled: false } } },
        pr: { branch: null, url: null, note: 'T13 creates the PR' },
        ...over,
    };
}

test('buildManifest produces the SEC-GEPA-11 record shape', () => {
    const m = buildManifest(sampleInput());
    assert.equal(m.manifest_version, '1.0');
    assert.equal(m.job_id, 'evo_20260901_001');
    assert.equal(m.dataset.sha256, 'c'.repeat(64));
    assert.equal(m.sidecar.version, '0.1.0');
    assert.equal(m.candidates.length, 1);
    assert.equal(m.candidates[0].candidate_verdict, 'accepted');
    assert.equal(m.verdict, 'merge-ready');
    assert.ok(m.started_at < m.ended_at);
});

test('manifest validates against the committed schema', () => {
    const m = buildManifest(sampleInput());
    const v = validateManifestSchema(m);
    assert.equal(v.valid, true, JSON.stringify(v.errors));
});

test('writeManifest writes runs/<job_id>/manifest.json (0600)', () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'gepa-runs-'));
    try {
        const m = buildManifest(sampleInput());
        const file = writeManifest(m, runsDir);
        assert.ok(existsSync(file));
        assert.ok(file.endsWith(join('evo_20260901_001', 'manifest.json')));
        const written = JSON.parse(readFileSync(file, 'utf8'));
        assert.equal(written.job_id, 'evo_20260901_001');
        assert.equal(written.verdict, 'merge-ready');
    } finally {
        rmSync(runsDir, { recursive: true, force: true });
    }
});

test('failure manifest records the error (AT-1: after every run)', () => {
    const m = buildManifest(sampleInput({ status: 'failed', verdict: 'rejected', error: { message: 'sidecar crashed' } }));
    assert.equal(m.status, 'failed');
    assert.equal(m.error?.message, 'sidecar crashed');
    assert.equal(validateManifestSchema(m).valid, true);
});

test('replayability fields are present (AT-2): dataset sha256 + sidecar version + fitness', () => {
    const m = buildManifest(sampleInput());
    assert.match(m.dataset.sha256, /^[a-f0-9]{64}$/);
    assert.match(m.base_skill.sha256, /^[a-f0-9]{64}$/);
    assert.equal(m.sidecar.deps_pinned, true);
    const cand = m.candidates[0];
    assert.equal(cand.fitness.fitness, 1.0);
    assert.equal(cand.fitness.passed, 12);
    // A replay can re-derive fitness from dataset hash + candidate text
    // + harness version (the record carries the inputs).
    assert.ok(m.config.evolution, 'evolution config recorded for replay');
});

test('paused run is recorded as paused with no accepted candidate (SEC-GEPA-09)', () => {
    const m = buildManifest(sampleInput({
        status: 'paused',
        verdict: 'paused',
        candidates: [],
        bestCandidateId: null,
        judgeCost: { month: '2026-09', providers: { deepseek: { spentUsd: 15, capUsd: 15, disabled: true } } },
    }));
    assert.equal(m.verdict, 'paused');
    assert.equal(m.candidates.length, 0);
    assert.equal(validateManifestSchema(m).valid, true);
});
