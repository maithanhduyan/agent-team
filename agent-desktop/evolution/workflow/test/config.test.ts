/**
 * T13 workflow tests — config (TASK-9054, Redmine #48).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteOwnerRepo, loadWorkflowConfig } from '../src/config.js';

test('config: owner/repo parsed from a plain https remote', () => {
    assert.deepEqual(parseRemoteOwnerRepo('https://github.com/maithanhduyan/agent-team.git'), {
        owner: 'maithanhduyan',
        repo: 'agent-team',
    });
});

test('config: owner/repo parsed from a token-embedded remote (never leaks the token)', () => {
    const parsed = parseRemoteOwnerRepo('https://x-access-token:secret-token@github.com/maithanhduyan/agent-team.git');
    assert.deepEqual(parsed, { owner: 'maithanhduyan', repo: 'agent-team' });
});

test('config: owner/repo parsed from an ssh remote', () => {
    assert.deepEqual(parseRemoteOwnerRepo('git@github.com:maithanhduyan/agent-team.git'), {
        owner: 'maithanhduyan',
        repo: 'agent-team',
    });
});

test('config: loadWorkflowConfig defaults (registry dir, target, approvers)', () => {
    const cfg = loadWorkflowConfig({ env: {}, cwd: process.cwd() });
    assert.equal(cfg.registryDir, 'agents/skills');
    assert.equal(cfg.targetBranch, 'develop');
    assert.equal(cfg.remote, 'origin');
    assert.equal(cfg.approverOwner, 'maithanhduyan');
    assert.equal(cfg.approverCto, 'cto');
    assert.equal(cfg.dryRun, false);
    assert.equal(cfg.token, null);
});

test('config: env overrides are honored', () => {
    const cfg = loadWorkflowConfig({
        env: {
            EVOLUTION_SKILL_REGISTRY: 'skills',
            PR_TARGET_BRANCH: 'release/v0.5',
            PR_OWNER: 'o',
            PR_REPO: 'r',
            PR_APPROVER_OWNER: 'owner-user',
            PR_APPROVER_CTO: 'cto-user',
            PR_DRY_RUN: '1',
        },
        cwd: process.cwd(),
    });
    assert.equal(cfg.registryDir, 'skills');
    assert.equal(cfg.targetBranch, 'release/v0.5');
    assert.equal(cfg.owner, 'o');
    assert.equal(cfg.repo, 'r');
    assert.equal(cfg.approverOwner, 'owner-user');
    assert.equal(cfg.approverCto, 'cto-user');
    assert.equal(cfg.dryRun, true);
});
