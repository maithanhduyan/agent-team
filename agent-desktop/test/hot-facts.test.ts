import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CoreWriter } from '../src/core-writer.js';
import { injectHotFacts, loadHotFacts, projectDay30Decay } from '../src/hot-facts.js';
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

/* ------------------------------------------------------------------ */
/* Day-30 decay projection (§10.4 — Redmine #39 / T06 F4)             */
/* ------------------------------------------------------------------ */

/** core.md with a fresh hot fact and one not re-observed for ~2 cycles. */
async function makeDecayedCoreMd(dir: string, daysAgo: number, extra: Partial<{ importance: number; hot: boolean }> = {}) {
    const core = new CoreWriter(dir, { now: () => NOW_DATE, log: silentLog });
    const src = { provenance: 'user_stated' as const, source: 'telegram:chat:1' };
    await core.appendFact(CONS, { statement: 'Fresh hot fact.', importance: 0.9, hot: true, ...src, supporting_observations: ['evt_a'] });
    const lastObserved = new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString();
    await core.appendFact(CONS, {
        statement: 'Stale hot fact.',
        importance: extra.importance ?? 0.9,
        hot: extra.hot ?? true,
        last_observed: lastObserved,
        ...src,
        supporting_observations: ['evt_b'],
    });
    return { lastObserved };
}

test('Day-30 projection: a hot fact not re-observed for 2 cycles is excluded from injection (§10.4, Redmine #39 / T06 F4)', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `mem-hot-${seq++}-`));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await makeDecayedCoreMd(dir, 62); // 2 cycles → 0.9 → 0.45 → 0.225, stale

    const facts = await loadHotFacts(dir, { now: () => NOW_DATE });
    assert.deepEqual(facts.map((f) => f.id), ['fact_0001'], 'decayed fact_0002 (0.225/stale) must not be injected');
});

test('Day-30 projection: 1 cycle halves importance (0.9 → 0.45) — excluded at 0.8, injected with the projected value at minImportance 0.4', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `mem-hot-${seq++}-`));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await makeDecayedCoreMd(dir, 31); // 1 cycle → 0.45

    const atDefault = await loadHotFacts(dir, { now: () => NOW_DATE });
    assert.deepEqual(atDefault.map((f) => f.id), ['fact_0001'], '0.45 < 0.8 → excluded at default threshold');

    const lowered = await loadHotFacts(dir, { now: () => NOW_DATE, minImportance: 0.4 });
    assert.deepEqual(lowered.map((f) => f.id), ['fact_0001', 'fact_0002'], '0.45 >= 0.4 → still injected');
    assert.equal(lowered.find((f) => f.id === 'fact_0002')!.importance, 0.45, 'injected with the projected importance');
});

test('Day-30 projection: stale (2 cycles) facts are excluded even when minImportance is below the projected importance', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `mem-hot-${seq++}-`));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await makeDecayedCoreMd(dir, 62); // 0.225, stale

    const facts = await loadHotFacts(dir, { now: () => NOW_DATE, minImportance: 0.1 });
    assert.deepEqual(facts.map((f) => f.id), ['fact_0001'], '0.225 >= 0.1 but stale → excluded (§10.4)');
});

test('Day-30 projection honors the decayDays option and the importance floor (§10.4)', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `mem-hot-${seq++}-`));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await makeDecayedCoreMd(dir, 40, { importance: 0.2 }); // 1 cycle at 30 d → 0.1 (floored); 0 cycles at 90 d → 0.2

    const atDefault = await loadHotFacts(dir, { now: () => NOW_DATE, minImportance: 0.1 });
    assert.deepEqual(atDefault.map((f) => f.id), ['fact_0001', 'fact_0002']);
    assert.equal(atDefault.find((f) => f.id === 'fact_0002')!.importance, 0.1, 'importance floored at 0.1 after 1 cycle (0.2 → 0.1)');

    const relaxed = await loadHotFacts(dir, { now: () => NOW_DATE, minImportance: 0.1, decayDays: 90 });
    assert.deepEqual(relaxed.map((f) => f.id), ['fact_0001', 'fact_0002']);
    assert.equal(relaxed.find((f) => f.id === 'fact_0002')!.importance, 0.2, 'decayDays=90 → 0 cycles → no decay');
});

test('projectDay30Decay: pure Day-30 math — halving, floor, stale at 2 cycles, demotion (§10.4)', () => {
    const nowMs = Date.parse(NOW);
    const mk = (last_observed: string, importance = 0.9, hot = true) => ({ importance, hot, last_observed, status: 'active' as const });

    assert.deepEqual(projectDay30Decay(mk('2026-09-01T00:00:00.000Z'), nowMs), { importance: 0.9, status: 'active', hot: true, cycles: 0, stale: false });
    assert.deepEqual(projectDay30Decay(mk('2026-08-01T00:00:00.000Z'), nowMs), { importance: 0.45, status: 'active', hot: false, cycles: 1, stale: false });
    assert.deepEqual(projectDay30Decay(mk('2026-07-01T00:00:00.000Z'), nowMs), { importance: 0.225, status: 'stale', hot: false, cycles: 2, stale: true });

    // floor: many cycles never drop below 0.1
    assert.equal(projectDay30Decay(mk('2025-01-01T00:00:00.000Z', 0.2), nowMs).importance, 0.1);
    // already-decayed status is kept (projection never resurrects)
    const staleFact = projectDay30Decay({ importance: 0.3, hot: false, last_observed: '2026-09-01T00:00:00.000Z', status: 'stale' }, nowMs);
    assert.equal(staleFact.status, 'stale');
    // unparseable last_observed → treated as fresh (deterministic fallback)
    assert.equal(projectDay30Decay(mk('not-a-date'), nowMs).cycles, 0);
});
