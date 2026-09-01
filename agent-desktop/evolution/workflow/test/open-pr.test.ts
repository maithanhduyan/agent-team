/**
 * T13 workflow tests — candidate → branch → PR (TASK-9054, Redmine #48).
 *
 * BR-1/BR-2: dedicated branch `evolution/<skill>/<run-id>-<candidate>`;
 * branch contains ONLY candidate SKILL.md + dataset version reference +
 * run audit record. Gates BEFORE a PR (T10 §7.2): non-merge-ready runs
 * and failing candidates are REJECTED — no PR. PR creation never
 * auto-merges (SEC-GEPA-06/07).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
    planCandidatePr,
    executeOpenPr,
    loadRunManifest,
    findCandidate,
    resolveManifestPath,
    linkManifestToPr,
    type OpenPrInput,
} from '../src/open-pr.js';
import { candidateBranchName, buildBranchFileSet } from '../src/registry.js';
import { createGitHubClient } from '../src/github.js';
import { checkApprovals } from '../src/review.js';
import type { WorkflowConfig } from '../src/config.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const MANIFEST = resolve(FIXTURES, 'manifest-merge-ready.json');

function cfg(over: Partial<WorkflowConfig> = {}): WorkflowConfig {
    return {
        repoRoot: REPO_ROOT,
        registryDir: 'agents/skills',
        remote: 'origin',
        targetBranch: 'develop',
        owner: 'maithanhduyan',
        repo: 'agent-team',
        token: null,
        approverOwner: 'maithanhduyan',
        approverCto: 'cto',
        dryRun: true,
        noPush: false,
        ...over,
    };
}

function pendingApprovals(): ReturnType<typeof checkApprovals> {
    return checkApprovals([], { roleMap: { owner: ['maithanhduyan'], cto: ['cto'] } });
}

function inputFor(over: Partial<OpenPrInput> = {}): OpenPrInput {
    const { manifest, ref } = loadRunManifest(MANIFEST);
    const candidate = findCandidate(manifest, 'gen0-01');
    const skillText = readFileSync(
        resolveManifestPath(MANIFEST, candidate.skill_path ?? 'candidates/gen0-01/SKILL.md'),
        'utf8',
    );
    return {
        manifestPath: MANIFEST,
        candidateId: 'gen0-01',
        candidateSkillText: skillText,
        cfg: cfg(),
        approvals: pendingApprovals(),
        ...over,
    };
}

test('BR-1: branch name follows evolution/<skill>/<run-id>-<candidate>', () => {
    assert.equal(
        candidateBranchName('install-dsh', 'evo_20260901_001', 'gen0-01'),
        'evolution/install-dsh/evo_20260901_001-gen0-01',
    );
});

test('BR-2: the plan carries EXACTLY the 3 allowed files', () => {
    const plan = planCandidatePr(inputFor());
    assert.equal(plan.branch, 'evolution/install-dsh/evo_20260901_001-gen0-01');
    assert.equal(plan.target, 'develop');
    assert.deepEqual(
        plan.files.map((f) => f.path),
        [
            'agents/skills/install-dsh/SKILL.md',
            'agents/skills/install-dsh/dataset.ref.json',
            'agents/skills/install-dsh/run-audit-record.json',
        ],
    );
    // SKILL.md content equals the candidate text.
    assert.equal(plan.files[0].content, inputFor().candidateSkillText);
    // dataset.ref.json pins the dataset version + sha256 (COV-3).
    const datasetRef = JSON.parse(plan.files[1].content) as { dataset_id: string; sha256: string };
    assert.equal(datasetRef.dataset_id, 'install-dsh-v0.1');
    assert.match(datasetRef.sha256, /^[a-f0-9]{64}$/);
    // run-audit-record.json is the full run manifest (SEC-GEPA-11).
    const audit = JSON.parse(plan.files[2].content) as { run_id: string; verdict: string };
    assert.equal(audit.run_id, 'evo_20260901_001');
    assert.equal(audit.verdict, 'merge-ready');
});

test('gates: a non-merge-ready run is REJECTED — no PR (R-2)', () => {
    const { manifest } = loadRunManifest(MANIFEST);
    const copy = structuredClone(manifest) as typeof manifest;
    copy.verdict = 'rejected';
    copy.status = 'completed';
    const dir = mkdtempSync(join(tmpdir(), 'gepa-reject-'));
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify(copy));
    try {
        assert.throws(() => planCandidatePr(inputFor({ manifestPath: p })), /REJECTED/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('gates: a rejected candidate is REJECTED — no PR', () => {
    const { manifest } = loadRunManifest(MANIFEST);
    const copy = structuredClone(manifest) as typeof manifest;
    copy.candidates[0].candidate_verdict = 'rejected';
    const dir = mkdtempSync(join(tmpdir(), 'gepa-reject-'));
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify(copy));
    try {
        assert.throws(() => planCandidatePr(inputFor({ manifestPath: p })), /REJECTED/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('gates: an oversized candidate is REJECTED — no PR (SEC-GEPA-03, R-5)', () => {
    const { manifest } = loadRunManifest(MANIFEST);
    const copy = structuredClone(manifest) as typeof manifest;
    copy.candidates[0].size_bytes = 20_000;
    const dir = mkdtempSync(join(tmpdir(), 'gepa-reject-'));
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify(copy));
    try {
        assert.throws(() => planCandidatePr(inputFor({ manifestPath: p })), /SEC-GEPA-03/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('SEC-GEPA-08: a candidate containing a secret is REJECTED — no PR (R-9)', () => {
    const input = inputFor({ candidateSkillText: '# Skill: install-dsh\n\nsk-abc123secret\n' });
    assert.throws(() => planCandidatePr(input), /SEC-GEPA-08/);
});

test('executeOpenPr in dry-run makes NO git/network changes', async () => {
    const plan = planCandidatePr(inputFor());
    const client = createGitHubClient({ token: null, dryRun: true });
    const result = await executeOpenPr(plan, cfg({ dryRun: true }), client);
    assert.equal(result.pr, null);
    assert.equal(result.worktree, null);
    assert.equal(client.calls.length, 0);
});

test('AT-3: linkManifestToPr writes the PR link back into the run record', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gepa-link-'));
    const p = join(dir, 'manifest.json');
    writeFileSync(p, readFileSync(MANIFEST, 'utf8'));
    try {
        linkManifestToPr(p, {
            branch: 'evolution/install-dsh/evo_20260901_001-gen0-01',
            url: 'https://github.com/maithanhduyan/agent-team/pull/99',
            note: 'PR opened by the T13 workflow (no auto-merge); awaiting owner + cto approval',
        });
        const { manifest } = loadRunManifest(p);
        assert.equal(manifest.pr.url, 'https://github.com/maithanhduyan/agent-team/pull/99');
        assert.equal(manifest.pr.branch, 'evolution/install-dsh/evo_20260901_001-gen0-01');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('github client: openPullRequest in dry-run records the call and returns a stub', async () => {
    const client = createGitHubClient({ token: null, dryRun: true });
    const pr = await client.openPullRequest({
        owner: 'maithanhduyan',
        repo: 'agent-team',
        head: 'evolution/install-dsh/evo_20260901_001-gen0-01',
        base: 'develop',
        title: 'evolution(install-dsh): candidate gen0-01',
        body: 'metadata',
    });
    assert.equal(pr.number, 0);
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].method, 'POST');
});

test('github client: no merge endpoint exists (SEC-GEPA-07 structural)', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../src/github.ts'), 'utf8');
    assert.ok(!/\/pulls\/\d+\/merge/.test(src), 'github client must not expose a merge endpoint');
});

function havePython(): boolean {
    try {
        execFileSync('python3', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}
const describe = havePython() ? test : test.skip;

describe('T12 integration: candidate text is persisted (AT-2) and the workflow gates the run verdict', async () => {
    const { loadEvolutionConfig } = await import('../../runner/src/config.js');
    const { runEvolution } = await import('../../runner/src/run.js');
    const runsDir = mkdtempSync(join(tmpdir(), 'gepa-t13-integration-'));
    try {
        const cfgRun = loadEvolutionConfig(
            {
                EVOLUTION_RUNS_DIR: runsDir,
                EVOLUTION_SIDECAR_DIR: join(REPO_ROOT, 'agent-desktop/evolution/sidecar'),
                EVOLUTION_DATASET: join(REPO_ROOT, 'agent-desktop/evolution/datasets/install-dsh-v0.1.json'),
                EVOLUTION_BASE_SKILL: join(REPO_ROOT, 'agent-desktop/evolution/harness/fixtures/install-dsh/SKILL.md'),
                EVOLUTION_GENERATIONS: '1',
                EVOLUTION_POPULATION_SIZE: '3',
                EVOLUTION_ELITISM: '1',
                EVOLUTION_JUDGE_DRY_RUN: '1',
                EVOLUTION_SIDECAR_TIMEOUT_S: '60',
            },
            join(REPO_ROOT, 'agent-desktop'),
        );
        const outcome = await runEvolution(cfgRun, { jobId: 'evo_t13_integration', judgeCostDir: runsDir });
        assert.equal(outcome.error, null, outcome.error ?? '');
        const manifestPath = outcome.manifestPath!;
        const manifest = outcome.manifest!;

        for (const cand of manifest.candidates) {
            // T13 integration (AT-2): the run manifest now carries the
            // candidate text file, so the record is replayable.
            assert.ok(cand.skill_path, 'candidate skill_path must be persisted (AT-2)');
            assert.ok(existsSync(cand.skill_path!), 'candidate SKILL.md file exists in the run dir');

            const text = readFileSync(cand.skill_path!, 'utf8');
            if (manifest.verdict === 'merge-ready') {
                // MockLM appends fix-guidance to the base skill, so a
                // candidate can genuinely pass every gate → the workflow
                // plans a valid PR (branch + the 3 allowed files).
                const plan = planCandidatePr({
                    manifestPath,
                    candidateId: cand.candidate_id,
                    candidateSkillText: text,
                    cfg: cfg(),
                    approvals: pendingApprovals(),
                });
                assert.equal(
                    plan.branch,
                    candidateBranchName(manifest.skill, manifest.run_id, cand.candidate_id),
                );
                assert.equal(plan.files.length, 3);
            } else {
                // Non-merge-ready run → the workflow REFUSES to open a PR.
                assert.throws(
                    () =>
                        planCandidatePr({
                            manifestPath,
                            candidateId: cand.candidate_id,
                            candidateSkillText: text,
                            cfg: cfg(),
                            approvals: pendingApprovals(),
                        }),
                    /REJECTED/,
                );
            }
        }
        if (manifest.candidates.length === 0) {
            assert.ok(['no-candidate', 'rejected'].includes(manifest.verdict));
        }
    } finally {
        rmSync(runsDir, { recursive: true, force: true });
    }
}, { timeout: 120_000 });
