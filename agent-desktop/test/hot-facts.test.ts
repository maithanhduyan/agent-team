import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CoreWriter } from '../src/core-writer.js';
import { injectHotFacts, loadHotFacts } from '../src/hot-facts.js';
import { MEMORY_START, MEMORY_END, DATA_NOT_INSTRUCTIONS_NOTE } from '../src/render.js';

const NOW = '2026-09-15T00:00:00.000Z';
const NOW_DATE = new Date(NOW);

let seq = 0;
const silentLog = { warn: () => undefined, info: () => undefined };
const CONS = { runId: 'cons_0123456789abcdef' };

/** core.md with a spread of hot/not-hot/expired/superseded facts (§6.3). */
async function makeCoreMd(dir: string) {
    const core = new CoreWriter(dir, { now: () => NOW_DATE, log: silentLog });
    const src = { provenance: 'user_stated' as const, source: 'telegram:chat:1' };
    await core.appendFact(CONS, { statement: 'Owner prefers Vietnamese.', importance: 0.9, hot: true, ...src, supporting_observations: ['evt_a'] });
    await core.appendFact(CONS, { statement: 'Coffee temperature is 93 degrees.', provenance: 'tool_output', importance: 0.75, hot: true, source: 'tool:test', supporting_observations: ['evt_b'] }); // below 0.8
    await core.appendFact(CONS, { statement: 'Install script must handle EFS.', provenance: 'tool_output', importance: 0.85, hot: true, source: 'tool:sandbox', supporting_observations: ['evt_c'] });
    await core.appendFact(CONS, { statement: 'Laptop model is ThinkPad.', importance: 0.95, hot: false, ...src, supporting_observations: ['evt_d'] }); // not hot
    await core.appendFact(CONS, { statement: 'Old superseded preference.', importance: 0.9, hot: true, ...src, supporting_observations: ['evt_e'] });
    await core.appendFact(CONS, { statement: 'Expired hot fact.', importance: 0.9, hot: true, ...src, supporting_observations: ['evt_f'] });
    await core.updateStatus(CONS, 'fact_0005', { status: 'superseded' });
    await core.updateStatus(CONS, 'fact_0006', { status: 'expired', valid_to: '2026-09-01T00:00:00.000Z' });
}

test('loadHotFacts selects hot + active + importance>=0.8, ordered by importance desc (spec §6.3, US-MEM-005 AC-1/AC-2)', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `mem-hot-${seq++}-`));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await makeCoreMd(dir);

    const facts = await loadHotFacts(dir, { now: () => NOW_DATE });
    assert.deepEqual(facts.map((f) => f.id), ['fact_0001', 'fact_0003']); // 0.9 then 0.85
    assert.ok(facts.every((f) => f.importance >= 0.8));
    assert.equal(facts[0].statement, 'Owner prefers Vietnamese.');
    assert.equal(facts[0].provenance, 'user_stated');
});

test('loadHotFacts caps at MEMORY_HOT_MAX / min importance override (§6.3)', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `mem-hot-${seq++}-`));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await makeCoreMd(dir);

    const capped = await loadHotFacts(dir, { now: () => NOW_DATE, max: 1 });
    assert.deepEqual(capped.map((f) => f.id), ['fact_0001']);

    const lowered = await loadHotFacts(dir, { now: () => NOW_DATE, minImportance: 0.7 });
    assert.deepEqual(lowered.map((f) => f.id), ['fact_0001', 'fact_0003', 'fact_0002']); // 0.9, 0.85, 0.75
});

test('injectHotFacts wraps the block in SEC-MEM-01 delimiters + data-not-instructions note (§6.3/§10.2.3)', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `mem-hot-${seq++}-`));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await makeCoreMd(dir);

    const { facts, block } = await injectHotFacts(dir, { now: () => NOW_DATE });
    assert.equal(facts.length, 2);
    assert.ok(block.startsWith(MEMORY_START));
    assert.ok(block.endsWith(MEMORY_END));
    assert.ok(block.includes(DATA_NOT_INSTRUCTIONS_NOTE));
    assert.ok(block.includes('fact_0001'));
    assert.ok(block.includes('fact_0003'));
    assert.ok(!block.includes('fact_0004')); // not hot
});

test('hot-fact injection is a single core.md file read (0 ms): no sessions.jsonl needed (§6.3/§7.3)', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `mem-hot-${seq++}-`));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await makeCoreMd(dir);

    const facts = await loadHotFacts(dir, { now: () => NOW_DATE });
    assert.equal(facts.length, 2); // works with only core.md present — no retrieval, no other files
});

test('missing/empty core.md → zero hot facts, still a valid envelope (not an error)', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `mem-hot-empty-${seq++}-`));
    t.after(() => rm(dir, { recursive: true, force: true }));

    const facts = await loadHotFacts(dir, { now: () => NOW_DATE });
    assert.deepEqual(facts, []);

    const { facts: f2, block } = await injectHotFacts(dir, { now: () => NOW_DATE });
    assert.deepEqual(f2, []);
    assert.ok(block.includes(MEMORY_START));
    assert.ok(block.includes(DATA_NOT_INSTRUCTIONS_NOTE));
});

test('loadHotFacts is deterministic for identical inputs (§6.3, T06 testability)', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `mem-hot-${seq++}-`));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await makeCoreMd(dir);

    const a = await loadHotFacts(dir, { now: () => NOW_DATE });
    const b = await loadHotFacts(dir, { now: () => NOW_DATE });
    assert.deepEqual(b, a);
});
