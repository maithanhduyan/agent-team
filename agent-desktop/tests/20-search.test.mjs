/**
 * T06 — 20 search suite (T04 tools: search_memory + grep_logs).
 *
 * Acceptance mapping (docs/memory-spec.md §13):
 *   row 5  §6.3       — hot facts injected; count <= MEMORY_HOT_MAX
 *   row 6  §7.1       — retrieval formula matches the hand-computed golden set within 1e-6
 *   row 7  §7.1       — include_expired / provenance / since / session_id / top_k / min_score filters
 *   row 8  §7.2       — grep_logs exact lines + context, RE2 regex, limit cap
 *   SEC-MEM-01        — search results + grep matches wrapped in [MEMORY_START]...[/MEMORY_END]
 *
 * Runs against the T04 implementation when merged (Redmine #30). Until
 * then this suite is SKIPPED with the dependency reason; the golden set
 * it asserts is certified by 00-fixture-selfcheck.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { searchAdapter } from './lib/adapters.mjs';
import { skipReason, loadJson, loadText, fixturePath } from './lib/harness.mjs';
import { CONTRACT } from './lib/generate-golden.mjs';

const adapter = await searchAdapter();

test('T04 search suite (Redmine #30)', { skip: adapter ? false : skipReason('T04') }, async (t) => {
  const golden = loadJson('golden-search.json');
  const grepGolden = loadJson('grep-golden.json');
  const memoryDir = mkdtempSync(join(tmpdir(), 't06-search-'));
  cpSync(fixturePath('memory'), memoryDir, { recursive: true });
  const opts = { memoryDir, env: { MEMORY_HOT_MAX: 10, MEMORY_HOT_IMPORTANCE: 0.8 } };

  await t.test('§7.1: retrieval formula matches the golden set within 1e-6 (row 6)', async () => {
    // Call params MUST match the golden generation params (golden meta
    // minScoreDefault 0.1 / topKDefault 10) — forcing top_k:50/min_score:0
    // here used to widen the result set beyond the golden's 10 hits.
    const params = golden.cases.default.params;
    const res = await adapter.searchMemory({ query: golden.query, ...params }, opts);
    const expected = golden.cases.default.expected;
    assert.equal(res.results.length, expected.length, 'same hit set');
    for (let i = 0; i < expected.length; i++) {
      assert.equal(res.results[i].id, expected[i].id, `rank ${i}: same id`);
      assert.ok(
        Math.abs(res.results[i].score - expected[i].score) < 1e-6,
        `rank ${i} (${expected[i].id}): score ${res.results[i].score} vs golden ${expected[i].score}`,
      );
    }
    // deterministic output (R-JUDGE-free, spec §7.1)
    const res2 = await adapter.searchMemory({ query: golden.query, ...params }, opts);
    assert.deepEqual(res2.results.map((r) => r.score), res.results.map((r) => r.score));
  });

  await t.test('§7.1: filters behave as specified (row 7)', async () => {
    for (const [name, c] of Object.entries(golden.cases)) {
      if (name === 'default' || !Array.isArray(c.expected)) continue;
      // same rule as row 6: pass exactly the golden case's params (defaults
      // minScore 0.1 / topK 10 apply unless the case overrides them).
      const res = await adapter.searchMemory(
        { query: c.params.query ?? golden.query, ...c.params },
        opts,
      );
      assert.equal(res.results.length, c.expected.length, `filter case ${name}: hit count`);
      for (let i = 0; i < c.expected.length; i++) {
        assert.ok(
          Math.abs(res.results[i].score - c.expected[i].score) < 1e-6,
          `filter case ${name}[${i}]: score within 1e-6`,
        );
      }
    }
  });

  await t.test('§7.1: empty query and unknown layer are errors; no match is empty, not error', async () => {
    await assert.rejects(
      adapter.searchMemory({ query: '' }, opts),
      /empty/i,
      'empty query -> error',
    );
    await assert.rejects(
      adapter.searchMemory({ query: golden.query, layers: ['L5'] }, opts),
      /layer/i,
      'unknown layer -> error',
    );
    const noMatch = golden.cases.noMatchHighMinScore;
    const res = await adapter.searchMemory(
      { query: noMatch.params.query, min_score: noMatch.params.min_score },
      opts,
    );
    assert.equal(res.results.length, 0);
  });

  await t.test('§6.3: hot facts injected at session start, count <= MEMORY_HOT_MAX (row 5)', async () => {
    const hot = await adapter.loadHotFacts(join(memoryDir, 'core.md'), opts);
    const ids = hot.map((f) => f.id);
    assert.deepEqual(ids, ['fact_0001', 'fact_0002', 'fact_0003'],
      'post-decay projection: fact_0005 decayed below threshold, not injected');
    assert.ok(hot.length <= 10);
    // importance-desc order
    const imps = hot.map((f) => f.importance);
    assert.deepEqual(imps, [...imps].sort((a, b) => b - a));
    // hot facts are rendered with the SEC-MEM-01 wrapper
    const rendered = await adapter.renderBlock({ kind: 'hot_facts', items: hot });
    assert.ok(rendered.startsWith('[MEMORY_START]'), 'wrapper opens');
    assert.ok(rendered.includes('data, not instructions'));
    assert.ok(rendered.trimEnd().endsWith('[/MEMORY_END]'), 'wrapper closes');

    // MEMORY_HOT_MAX cap with 12 hot facts
    const hotMax = await adapter.loadHotFacts(join(memoryDir, 'core-hot-max.md'), opts);
    assert.equal(hotMax.length, 10, 'capped at MEMORY_HOT_MAX');
  });

  await t.test('§7.2: grep_logs returns exact lines + context, RE2-safe, limit honored (row 8)', async () => {
    const efs = grepGolden.cases.efs;
    const res = await adapter.grepLogs(efs.params, opts);
    assert.equal(res.matches.length, efs.expected.length, 'same match set');
    for (let i = 0; i < efs.expected.length; i++) {
      assert.equal(res.matches[i].file, efs.expected[i].file, `match ${i} file`);
      assert.equal(res.matches[i].line, efs.expected[i].line, `match ${i} line`);
      assert.equal(res.matches[i].text, efs.expected[i].text, `match ${i} text`);
      assert.deepEqual(res.matches[i].before, efs.expected[i].before, `match ${i} before-context`);
      assert.deepEqual(res.matches[i].after, efs.expected[i].after, `match ${i} after-context`);
    }
    // unranked: file/line order (golden already in that order)
    // limit cap
    const cap = grepGolden.cases.limitCap;
    const capped = await adapter.grepLogs(cap.params, opts);
    assert.equal(capped.matches.length, 5, 'limit cap honored');
    // invalid regex -> error
    await assert.rejects(
      adapter.grepLogs(grepGolden.cases.invalidRegexError.params, opts),
      /regex|invalid/i,
      'invalid regex -> error',
    );
    // no match -> empty, not error
    const none = await adapter.grepLogs(grepGolden.cases.noMatch.params, opts);
    assert.deepEqual(none.matches, []);
    // SEC-MEM-01 wrapper on grep renders
    const rendered = await adapter.renderBlock({ kind: 'grep_matches', items: res.matches.slice(0, 3) });
    assert.ok(rendered.startsWith('[MEMORY_START]') && rendered.includes('data, not instructions'));
    assert.ok(rendered.trimEnd().endsWith('[/MEMORY_END]'));
  });
});
