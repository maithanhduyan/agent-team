/**
 * T13 workflow tests — SEC-GEPA-03 size guardrail (TASK-9054, Redmine #48).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { checkSizeBytes, checkSizeFile, SIZE_LIMIT_BYTES } from '../src/size.js';

const FIXTURE_CANDIDATE = resolve(import.meta.dirname, 'fixtures/candidates/gen0-01/SKILL.md');

test('SEC-GEPA-03: fixture candidate (3802 bytes) passes the 15 KB limit', () => {
    const r = checkSizeFile(FIXTURE_CANDIDATE);
    assert.equal(r.id, 'SEC-GEPA-03');
    assert.equal(r.pass, true);
    assert.ok(r.actual <= SIZE_LIMIT_BYTES);
    assert.equal(SIZE_LIMIT_BYTES, 15360);
});

test('SEC-GEPA-03: oversized candidate is rejected (R-5)', () => {
    const r = checkSizeBytes(20_000);
    assert.equal(r.pass, false);
});

test('SEC-GEPA-03: boundary — exactly 15360 passes, 15361 rejects', () => {
    assert.equal(checkSizeBytes(15360).pass, true);
    assert.equal(checkSizeBytes(15361).pass, false);
});

test('SEC-GEPA-03: limit is fixed at 15 KB (T10 §8 — not raised)', () => {
    assert.equal(SIZE_LIMIT_BYTES, 15 * 1024);
});
