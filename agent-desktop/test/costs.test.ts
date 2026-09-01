import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CostTracker, monthKeyOf, DEFAULT_JUDGE_CAPS } from '../src/costs.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let seq = 0;
async function makeTracker(opts: ConstructorParameters<typeof CostTracker>[1] = {}) {
    const dir = await mkdtemp(path.join(tmpdir(), `mem-costs-${seq++}-`));
    return { dir, tracker: new CostTracker(dir, { month: '2026-09', ...opts }) };
}

test('monthKeyOf returns UTC YYYY-MM', () => {
    assert.equal(monthKeyOf(new Date('2026-09-15T00:00:00.000Z')), '2026-09');
    assert.equal(monthKeyOf(new Date('2026-12-31T23:59:59.000Z')), '2026-12');
});

test('fresh tracker: zero spend, defaults caps, file created on save', async (t) => {
    const { dir, tracker } = await makeTracker();
    t.after(() => rm(dir, { recursive: true, force: true }));
    await tracker.load();
    assert.equal(tracker.monthlySpend('deepseek'), 0);
    assert.equal(tracker.capFor('deepseek'), 15);
    assert.equal(tracker.capFor('gpt-4'), 10);
    assert.equal(tracker.capFor('gemini-2.5-pro'), 10);
    assert.equal(tracker.isCapped('deepseek'), false);

    await tracker.save();
    const raw = await readFile(path.join(dir, 'costs-2026-09.json'), 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.month, '2026-09');
});

test('recordCost accumulates spend and persists (SEC-COST-01)', async (t) => {
    const { dir, tracker } = await makeTracker();
    t.after(() => rm(dir, { recursive: true, force: true }));
    await tracker.recordCost('deepseek', 3.42);
    await tracker.recordCost('deepseek', 0.58);
    assert.equal(tracker.monthlySpend('deepseek'), 4.0);

    const reloaded = new CostTracker(dir, { month: '2026-09' });
    await reloaded.load();
    assert.equal(reloaded.monthlySpend('deepseek'), 4.0);
});

test('reaching the cap auto-disables the model for the month (§9.5)', async (t) => {
    const { dir, tracker } = await makeTracker();
    t.after(() => rm(dir, { recursive: true, force: true }));
    await tracker.recordCost('deepseek', 14.0);
    assert.equal(tracker.isCapped('deepseek'), false);
    const state = await tracker.recordCost('deepseek', 1.5); // crosses 15
    assert.equal(state.disabled, true);
    assert.equal(tracker.isCapped('deepseek'), true);
    assert.equal(tracker.monthlySpend('deepseek'), 15.5);

    const reloaded = new CostTracker(dir, { month: '2026-09' });
    await reloaded.load();
    assert.equal(reloaded.isCapped('deepseek'), true, 'disabled state persists');
});

test('allCapped: pause condition when every model is at its cap (SEC-COST-01)', async (t) => {
    const { dir, tracker } = await makeTracker();
    t.after(() => rm(dir, { recursive: true, force: true }));
    assert.equal(tracker.allCapped(['deepseek', 'gpt-4']), false);
    await tracker.recordCost('deepseek', 20);
    await tracker.recordCost('gpt-4', 20);
    assert.equal(tracker.allCapped(['deepseek', 'gpt-4']), true);
    assert.equal(tracker.allCapped(['deepseek', 'gpt-4', 'gemini-2.5-pro']), false);
});

test('a new calendar month resets the accumulated spend', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `mem-costs-${seq++}-`));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const september = new CostTracker(dir, { month: '2026-09' });
    await september.recordCost('deepseek', 20);
    assert.equal(september.isCapped('deepseek'), true);

    const october = new CostTracker(dir, { month: '2026-10' });
    await october.load();
    assert.equal(october.monthlySpend('deepseek'), 0, 'October starts fresh');
    assert.equal(october.isCapped('deepseek'), false);
});

test('corrupt cost file falls back to a fresh month (spec availability)', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `mem-costs-${seq++}-`));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(dir, 'costs-2026-09.json'), 'not json{', 'utf8');
    const tracker = new CostTracker(dir, { month: '2026-09' });
    await tracker.load();
    assert.equal(tracker.monthlySpend('deepseek'), 0);
});

test('summary reports per-model spend + caps without any keys (SEC-COST-02)', async (t) => {
    const { dir, tracker } = await makeTracker();
    t.after(() => rm(dir, { recursive: true, force: true }));
    await tracker.recordCost('deepseek', 3.0);
    const summary = tracker.summary();
    assert.equal(summary.month, '2026-09');
    assert.equal(summary.providers.deepseek.spentUsd, 3.0);
    assert.equal(summary.providers.deepseek.capUsd, 15);
    assert.equal(summary.providers['gpt-4'].spentUsd, 0);
    assert.equal(summary.providers['gemini-2.5-pro'].spentUsd, 0);
    const serialized = JSON.stringify(summary);
    assert.ok(!serialized.includes('sk-'), 'no key-shaped strings in the report');
});

test('DEFAULT_JUDGE_CAPS matches spec §9.5 (15/10/10)', () => {
    assert.deepEqual(DEFAULT_JUDGE_CAPS, { deepseek: 15, 'gpt-4': 10, 'gemini-2.5-pro': 10 });
});
