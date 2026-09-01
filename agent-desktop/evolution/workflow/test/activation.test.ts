/**
 * SEC-GEPA-05 no-hot-swap RUNTIME test (T13, TASK-9054, Redmine #48).
 *
 * Acceptance criterion 3: an unmerged candidate MUST NOT be activatable
 * in a live session; activation reads MERGED REGISTRY STATE ONLY.
 *
 * The test simulates the DSH runtime activation path:
 *   1. merged state contains the BASE skill hash;
 *   2. activating an UNMERGED candidate hash → REFUSED;
 *   3. after a human merge (candidate hash recorded in merged state) →
 *      allowed;
 *   4. fail-closed: missing/empty state activates nothing;
 *   5. structural: run manifests / candidate records are NOT valid
 *      activation inputs (hot-swap attempt, R-6).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    resolveActivation,
    assertRegistryState,
    emptyRegistryState,
    type RegistryState,
} from '../src/activation.js';

const BASE_SKILL = resolve(import.meta.dirname, '../../harness/fixtures/install-dsh/SKILL.md');
const CANDIDATE_SKILL = resolve(import.meta.dirname, 'fixtures/candidates/gen0-01/SKILL.md');

function sha256Of(file: string): string {
    return createHash('sha256').update(readFileSync(file, 'utf8'), 'utf8').digest('hex');
}

function mergedStateWithBase(): RegistryState {
    return {
        schema_version: 1,
        built_from: 'develop (merged registry state)',
        skills: {
            'install-dsh': {
                skill: 'install-dsh',
                sha256: sha256Of(BASE_SKILL),
                source: 'merged',
                merged_at: '2026-09-01T08:00:00.000Z',
                pr_url: 'https://github.com/maithanhduyan/agent-team/pull/1',
            },
        },
    };
}

test('SEC-GEPA-05: unmerged candidate is NOT activatable in a live session (R-6)', () => {
    const state = mergedStateWithBase();
    const candidateSha = sha256Of(CANDIDATE_SKILL);
    const d = resolveActivation(state, 'install-dsh', candidateSha);
    assert.equal(d.allowed, false);
    assert.match(d.reason, /SEC-GEPA-05/);
    assert.match(d.reason, /NOT merged|not the merged/);
});

test('SEC-GEPA-05: the merged base skill IS activatable (between sessions)', () => {
    const state = mergedStateWithBase();
    const d = resolveActivation(state, 'install-dsh', sha256Of(BASE_SKILL));
    assert.equal(d.allowed, true);
});

test('SEC-GEPA-05: after human merge the candidate becomes activatable', () => {
    // Simulate the human merge: the candidate hash is recorded in the
    // merged registry state (with its PR link) — only then activation is
    // allowed, and only between sessions.
    const state = mergedStateWithBase();
    const candidateSha = sha256Of(CANDIDATE_SKILL);
    state.skills['install-dsh'] = {
        skill: 'install-dsh',
        sha256: candidateSha,
        source: 'merged',
        merged_at: '2026-09-02T10:00:00.000Z',
        pr_url: 'https://github.com/maithanhduyan/agent-team/pull/99',
    };
    const d = resolveActivation(state, 'install-dsh', candidateSha);
    assert.equal(d.allowed, true);
    assert.match(d.reason, /between sessions/);
});

test('SEC-GEPA-05: fail-closed — empty/missing registry state activates nothing', () => {
    const state = emptyRegistryState('test');
    const d = resolveActivation(state, 'install-dsh', sha256Of(BASE_SKILL));
    assert.equal(d.allowed, false);
});

test('SEC-GEPA-05: unknown skill is refused', () => {
    const state = mergedStateWithBase();
    const d = resolveActivation(state, 'not-a-skill', sha256Of(BASE_SKILL));
    assert.equal(d.allowed, false);
});

test('SEC-GEPA-05: a run manifest is NOT a valid activation input (structural)', () => {
    const manifest = JSON.parse(
        readFileSync(resolve(import.meta.dirname, 'fixtures/manifest-merge-ready.json'), 'utf8'),
    ) as unknown;
    assert.throws(() => assertRegistryState(manifest), /merged registry state only/);
});

test('SEC-GEPA-05: a candidate record is NOT a valid activation input (structural)', () => {
    const manifest = JSON.parse(
        readFileSync(resolve(import.meta.dirname, 'fixtures/manifest-merge-ready.json'), 'utf8'),
    ) as { candidates: unknown[] };
    const candidateRecord = manifest.candidates[0];
    assert.throws(() => assertRegistryState(candidateRecord), /merged registry state only/);
});
