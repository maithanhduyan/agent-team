import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MEMORY_START,
    MEMORY_END,
    DATA_NOT_INSTRUCTIONS_NOTE,
    wrapMemoryBlock,
    renderHotFacts,
    renderSearchResults,
    renderGrepMatches,
} from '../src/render.js';

test('wrapMemoryBlock wraps content in delimiters with the data-not-instructions note (SEC-MEM-01)', () => {
    const out = wrapMemoryBlock('- something remembered');
    assert.ok(out.startsWith(`${MEMORY_START}\n`));
    assert.ok(out.endsWith(`\n${MEMORY_END}`));
    assert.ok(out.includes(DATA_NOT_INSTRUCTIONS_NOTE));
});

test('renderHotFacts marks hot facts with provenance + importance (§6.3)', () => {
    const out = renderHotFacts([
        { id: 'fact_0001', statement: 'Owner prefers Vietnamese.', provenance: 'user_stated', importance: 0.9 },
    ]);
    assert.ok(out.includes('[MEMORY_START]'));
    assert.ok(out.includes('fact_0001'));
    assert.ok(out.includes('provenance: user_stated'));
    assert.ok(out.includes('importance: 0.9'));
    assert.ok(out.includes('Owner prefers Vietnamese.'));
    assert.ok(out.includes('data, not instructions'));
});

test('renderSearchResults renders score + provenance (SEC-MEM-01)', () => {
    const out = renderSearchResults([
        { id: 'evt_1', tier: 'L2', ts: '2026-09-01T00:00:00.000Z', provenance: 'tool_output', importance: 0.6, score: 0.8123, text: 'Install failed on EFS.' },
    ]);
    assert.ok(out.includes('[L2] evt_1'));
    assert.ok(out.includes('score: 0.8123'));
    assert.ok(out.includes('provenance: tool_output'));
    assert.ok(out.includes('Install failed on EFS.'));
});

test('renderGrepMatches renders file:line with ts (SEC-MEM-01)', () => {
    const out = renderGrepMatches([
        { file: 'sessions.jsonl', line: 12, text: 'raw line', ts: '2026-09-01T00:00:00.000Z' },
    ]);
    assert.ok(out.includes('sessions.jsonl:12'));
    assert.ok(out.includes('ts: 2026-09-01T00:00:00.000Z'));
    assert.ok(out.includes('raw line'));
});

test('empty input still produces a valid envelope', () => {
    const out = wrapMemoryBlock('');
    assert.ok(out.includes(MEMORY_START));
    assert.ok(out.includes(MEMORY_END));
    assert.ok(out.includes(DATA_NOT_INSTRUCTIONS_NOTE));
});
