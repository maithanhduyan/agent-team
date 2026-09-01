/**
 * T13 workflow tests — SEC-GEPA-04 A/B semantic preservation
 * (TASK-9054, Redmine #48). Candidate pass set ⊇ base pass set; 0
 * regressions on the SAME pinned suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { abRegression } from '../src/ab.js';

const FIXTURE_CANDIDATE = resolve(import.meta.dirname, 'fixtures/candidates/gen0-01/SKILL.md');

test('SEC-GEPA-04: fixture candidate passes A/B — fitness 1.0, 0 regressions', () => {
    const text = readFileSync(FIXTURE_CANDIDATE, 'utf8');
    const r = abRegression(text);
    assert.equal(r.valid, true);
    assert.equal(r.fitness, 1.0);
    assert.equal(r.passed, 12);
    assert.equal(r.total, 12);
    assert.equal(r.regressions.length, 0);
    assert.equal(r.pass, true);
    assert.equal(r.base_passed, 12);
    assert.equal(r.candidate_passed, 12);
});

test('SEC-GEPA-04: candidate that dropped EFS handling regresses (R-4)', () => {
    // Same suite, but the candidate text no longer documents the EFS
    // handling directives → the deterministic behavior proxy falls back
    // to the naive (failing) EFS behavior (T12 behavior.ts).
    const droppedEfs = `# Skill: install-dsh

## Install
1. Resolve the target path (junction / reparse point first).
2. Copy the payload.
3. Write config.

## Rules
- Never use raw recursive traversal across junctions without a visited-set.
`;
    const r = abRegression(droppedEfs);
    assert.equal(r.pass, false);
    assert.ok(r.fitness < 1.0 || r.regressions.length > 0, `expected regression, got fitness=${r.fitness}`);
});

test('SEC-GEPA-04: A/B is deterministic — same text ⇒ same result (CG-1)', () => {
    const text = readFileSync(FIXTURE_CANDIDATE, 'utf8');
    const a = abRegression(text);
    const b = abRegression(text);
    assert.deepEqual(a, b);
});
