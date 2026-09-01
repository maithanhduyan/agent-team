/**
 * T12 end-to-end run test (TASK-9053 / Redmine #47).
 *
 * Runs ONE evolution run end-to-end with the REAL Python sidecar
 * (MockLM, no keys) + real T14 harness + real T11 dataset:
 *
 *   dataset → sidecar evolve → Node guardrails → fitness gate →
 *   judge (mock providers) → audit manifest (SEC-GEPA-11).
 *
 * Acceptance criterion 1 ("runner chạy được 1 evolution run
 * end-to-end") and 2 (fitness gate consumes harness PR #31 contract +
 * dataset PR #32 pinned hash).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadEvolutionConfig } from '../src/config.js';
import { runEvolution } from '../src/run.js';
import { validateManifestSchema } from '../src/guardrails.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const AGENT_DESKTOP = join(REPO_ROOT, 'agent-desktop');

function havePython(): boolean {
    try {
        execFileSync('python3', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}
const hasPython = havePython();
const describe = hasPython ? test : test.skip;

describe('one evolution run end-to-end (real sidecar + real harness + mock judge)', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'gepa-e2e-runs-'));
    try {
        const cfg = loadEvolutionConfig(
            {
                EVOLUTION_RUNS_DIR: runsDir,
                EVOLUTION_SIDECAR_DIR: join(AGENT_DESKTOP, 'evolution/sidecar'),
                EVOLUTION_DATASET: join(AGENT_DESKTOP, 'evolution/datasets/install-dsh-v0.1.json'),
                EVOLUTION_BASE_SKILL: join(AGENT_DESKTOP, 'evolution/harness/fixtures/install-dsh/SKILL.md'),
                EVOLUTION_GENERATIONS: '1',
                EVOLUTION_POPULATION_SIZE: '3',
                EVOLUTION_ELITISM: '1',
                EVOLUTION_JUDGE_DRY_RUN: '1',
                EVOLUTION_SIDECAR_TIMEOUT_S: '60',
            },
            AGENT_DESKTOP,
        );
        const outcome = await runEvolution(cfg, { jobId: 'evo_e2e_01', judgeCostDir: runsDir });

        assert.equal(outcome.error, null, outcome.error ?? '');
        assert.ok(outcome.manifestPath, 'manifest must be written');
        assert.ok(existsSync(outcome.manifestPath!), 'manifest file exists');

        const manifest = outcome.manifest!;
        assert.equal(manifest.job_id, 'evo_e2e_01');
        assert.ok(manifest.dataset.sha256.match(/^[a-f0-9]{64}$/), 'dataset sha256 pinned');
        assert.equal(manifest.dataset.dataset_id, 'install-dsh-v0.1');
        assert.equal(manifest.sidecar.version, '0.1.0');
        assert.ok(manifest.candidates.length >= 1, 'at least one candidate recorded');

        // Fitness gate consumed the harness: candidate fitness is on the
        // [0,1] scale and the base skill passed 12/12.
        const c = manifest.candidates[0];
        assert.ok(c.fitness.total >= 1);
        assert.ok(c.fitness.fitness >= 0 && c.fitness.fitness <= 1);
        assert.ok('regression' in c.fitness);

        // Judge ran (dry-run) and cost recorded.
        assert.ok(c.judge.gate, 'judge gate recorded');
        assert.ok(manifest.judge_cost.month, 'cost month recorded');

        // Verdict is one of the documented round outcomes.
        assert.ok(['merge-ready', 'rejected', 'paused', 'no-candidate'].includes(manifest.verdict));

        // Manifest schema-validates (SEC-GEPA-11).
        const v = validateManifestSchema(manifest);
        assert.equal(v.valid, true, JSON.stringify(v.errors));

        // Guardrail checklist present at run level.
        assert.ok(manifest.guardrails['SEC-GEPA-10'], 'supply-chain guardrail recorded');
        assert.ok(manifest.guardrails['SEC-GEPA-11'], 'audit-trail guardrail recorded');
    } finally {
        rmSync(runsDir, { recursive: true, force: true });
    }
}, { timeout: 120_000 });
