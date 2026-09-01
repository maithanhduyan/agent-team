/**
 * T13 workflow tests — SEC-GEPA-06 human review + SEC-GEPA-07 no
 * auto-merge (TASK-9054, Redmine #48).
 *
 * SEC-GEPA-06: merge requires 2 explicit approvals — owner AND cto —
 * recorded on the PR; fewer than 2 ⇒ refuse (T10 §7.2 R-7).
 * SEC-GEPA-07: no automated merge path anywhere (R-8) — the structural
 * scan proves the T13 workflow (and the pipeline) sources contain no
 * merge action.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkApprovals, scanForAutoMerge, AUTO_MERGE_PATTERNS, type PullRequestReview } from '../src/review.js';

const ROLE_MAP = { owner: ['maithanhduyan'], cto: ['cto-user'] };

function review(reviewer: string, state: PullRequestReview['state']): PullRequestReview {
    return { reviewer, state, submitted_at: '2026-09-01T10:00:00.000Z' };
}

test('SEC-GEPA-06: owner + cto approvals ⇒ 2-approval rule satisfied (D-7)', () => {
    const r = checkApprovals([review('maithanhduyan', 'APPROVED'), review('cto-user', 'APPROVED')], { roleMap: ROLE_MAP });
    assert.equal(r.pass, true);
    assert.deepEqual(r.granted.sort(), ['cto (cto-user)', 'owner (maithanhduyan)'].sort());
    assert.deepEqual(r.missing, []);
});

test('SEC-GEPA-06: only owner approved ⇒ refused (missing cto, R-7)', () => {
    const r = checkApprovals([review('maithanhduyan', 'APPROVED')], { roleMap: ROLE_MAP });
    assert.equal(r.pass, false);
    assert.deepEqual(r.missing, ['cto']);
});

test('SEC-GEPA-06: only cto approved ⇒ refused (missing owner, R-7)', () => {
    const r = checkApprovals([review('cto-user', 'APPROVED')], { roleMap: ROLE_MAP });
    assert.equal(r.pass, false);
    assert.deepEqual(r.missing, ['owner']);
});

test('SEC-GEPA-06: a third-party approval does not count toward the 2 required', () => {
    const r = checkApprovals([review('someone-else', 'APPROVED'), review('maithanhduyan', 'APPROVED')], { roleMap: ROLE_MAP });
    assert.equal(r.pass, false);
    assert.deepEqual(r.missing, ['cto']);
});

test('SEC-GEPA-06: CHANGES_REQUESTED is not an approval', () => {
    const r = checkApprovals([review('maithanhduyan', 'CHANGES_REQUESTED'), review('cto-user', 'APPROVED')], { roleMap: ROLE_MAP });
    assert.equal(r.pass, false);
    assert.deepEqual(r.missing, ['owner']);
});

test('SEC-GEPA-06: zero approvals ⇒ refused', () => {
    const r = checkApprovals([], { roleMap: ROLE_MAP });
    assert.equal(r.pass, false);
});

test('SEC-GEPA-07: workflow sources contain no auto-merge action', () => {
    // Structural review: scan the ENTIRE T13 workflow source for merge
    // actions — 0 hits proves no auto-merge path exists in the workflow.
    const srcDir = resolve(import.meta.dirname, '../src');
    const files: Array<{ path: string; content: string }> = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const abs = join(dir, name);
            if (statSync(abs).isDirectory()) walk(abs);
            else files.push({ path: abs, content: readFileSync(abs, 'utf8') });
        }
    };
    walk(srcDir);
    const r = scanForAutoMerge(files);
    assert.equal(r.pass, true, `auto-merge hits: ${JSON.stringify(r.hits)}`);
    assert.equal(r.hits.length, 0);
});

test('SEC-GEPA-07: runner (T12) contains no merge action either', () => {
    const runnerSrc = resolve(import.meta.dirname, '../../runner/src');
    const files: Array<{ path: string; content: string }> = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const abs = join(dir, name);
            if (statSync(abs).isDirectory()) walk(abs);
            else files.push({ path: abs, content: readFileSync(abs, 'utf8') });
        }
    };
    walk(runnerSrc);
    const r = scanForAutoMerge(files);
    assert.equal(r.pass, true, `auto-merge hits: ${JSON.stringify(r.hits)}`);
});

test('SEC-GEPA-07: a synthetic merge action IS detected', () => {
    const files = [{ path: 'ci.sh', content: 'gh pr merge --merge\n' }];
    const r = scanForAutoMerge(files);
    assert.equal(r.pass, false);
    assert.equal(r.hits.length, 1);
    assert.equal(r.hits[0].pattern, 'gh-pr-merge');
});

test('SEC-GEPA-07: pattern list targets merge ACTIONS, not the word "merge"', () => {
    // The workflow legitimately talks about merges (docs/comments) but
    // must never contain a merge action. Assert the patterns do not fire
    // on prose like "no auto-merge", "never merges", "after merge".
    const prose = 'no auto-merge (SEC-GEPA-07); the runner never merges; merge is a human action; PR awaiting merge';
    const hits = AUTO_MERGE_PATTERNS.filter((p) => p.re.test(prose));
    assert.deepEqual(hits, []);
});
