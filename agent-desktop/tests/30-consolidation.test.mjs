/**
 * T06 — 30 consolidation suite (T05 consolidation job: reflection +
 * graduation + judge gate + guardrails).
 *
 * Acceptance mapping (docs/memory-spec.md §13):
 *   row 9   §8.3  — reflection {context, error, fix}
 *   row 10  §8.4  — graduation N=3-5 + judge; N<3 -> no write + rejection
 *   row 11  §9.3  — judge verdict JSON validates; malformed -> error
 *   row 12  §9.5  — cost cap -> auto-disable; all capped -> pause (mock providers)
 *   row 14  §10.3 — conflict -> supersede, never overwrite
 *   row 15  §10.4 — Day-30 decay + stale
 *   §9.4    consensus any|majority (mock providers)
 *
 * Judge-gate tests use ONLY mock providers (no API keys, no network) —
 * completion criterion 3.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { consolidationAdapter } from './lib/adapters.mjs';
import { skipReason, loadJson, loadText, fixturePath } from './lib/harness.mjs';
import { validateVerdict } from './lib/schema.mjs';
import { CONTRACT } from './lib/generate-golden.mjs';

const adapter = await consolidationAdapter();

test('T05 consolidation suite (Redmine #31)', { skip: adapter ? false : skipReason('T05') }, async (t) => {
  const verdicts = loadJson('judge-verdicts.json');
  const providers = loadJson('mock-providers.json');
  const graduation = loadJson('graduation-cases.json');
  const reflections = loadJson('reflection-cases.json');
  const decay = loadJson('decay-cases.json');
  const conflict = loadJson('conflict-cases.json');
  const memoryDir = mkdtempSync(join(tmpdir(), 't06-cons-'));
  cpSync(fixturePath('memory'), memoryDir, { recursive: true });
  const cfg = { refNow: CONTRACT.refNow, MEMORY_GRADUATION_N: 3, MEMORY_DECAY_DAYS: 30, MEMORY_HOT_IMPORTANCE: 0.8 };

  const mockProvider = (model, response) => ({
    name: model,
    isEnabled: () => true,
    generate: async () => {
      if (response.kind === 'error') throw new Error(response.message);
      if (response.kind === 'malformed') return { text: JSON.stringify(findPayload(response.name)), usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.001 };
      return { text: JSON.stringify(findPayload(response.name)), usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.001 };
    },
  });
  const findPayload = (name) => {
    const v = verdicts.valid.find((x) => x.name === name);
    if (v) return v.payload;
    const m = verdicts.malformed.find((x) => x.name === name);
    if (m) return m.payload;
    throw new Error(`unknown verdict sample ${name}`);
  };

  await t.test('§8.3: reflection output has {context, error, fix} (row 9)', async () => {
    for (const c of reflections.valid) {
      const out = await adapter.reflect(c.record.content, { provider: mockProvider('deepseek', { kind: 'verdict', name: 'approve' }) }, cfg);
      assert.deepEqual(Object.keys(out).sort(), ['context', 'error', 'fix']);
    }
    const invalid = reflections.invalid[0]; // missing fix
    await assert.rejects(adapter.reflect(invalid.record.content, {}, cfg), /fix|schema/i);
  });

  await t.test('§8.4: graduation rule — N=3..5 + judge approve; N<3 -> no write + rejection (row 10)', async () => {
    const byId = Object.fromEntries(graduation.cases.map((c) => [c.id, c]));

    // g1: N=2 -> rejection (even with judge approve)
    const g1 = byId['g1-n2-reject'];
    const r1 = await adapter.runConsolidation({ candidate: g1.candidate, judge: mockProvider('deepseek', g1.judge) }, cfg);
    assert.equal(r1.write_performed, false);
    assert.equal(r1.outcome, 'rejection');
    assert.ok(r1.rejection_record.type === 'rejection');
    assert.ok(r1.rejection_record.content.reason.toLowerCase().includes('insufficient'));

    // g2: N=3 + approve -> graduation with observation_count=3
    const g2 = byId['g2-n3-graduate'];
    const r2 = await adapter.runConsolidation({ candidate: g2.candidate, judge: mockProvider('deepseek', g2.judge) }, cfg);
    assert.equal(r2.write_performed, true);
    assert.equal(r2.l3_block.observation_count, 3);
    assert.equal(r2.l3_block.status, 'active');

    // g3: N=5 -> graduation
    const g3 = byId['g3-n5-graduate'];
    const r3 = await adapter.runConsolidation({ candidate: g3.candidate, judge: mockProvider('deepseek', g3.judge) }, cfg);
    assert.equal(r3.write_performed, true);
    assert.equal(r3.l3_block.observation_count, 5);

    // g4: N=3 but judge rejects -> rejection
    const g4 = byId['g4-n3-judge-reject'];
    const r4 = await adapter.runConsolidation({ candidate: g4.candidate, judge: mockProvider('deepseek', g4.judge) }, cfg);
    assert.equal(r4.write_performed, false);
    assert.equal(r4.outcome, 'rejection');

    // g5: N=6 outside 3..5 -> config error
    const g5 = byId['g5-n6-config-error'];
    await assert.rejects(adapter.runConsolidation({ candidate: g5.candidate }, cfg), /MEMORY_GRADUATION_N|3\.\.5|range/i);

    // g6: repeated supporting id is NOT distinct -> rejection
    const g6 = byId['g6-model-inferred-needs-judge'];
    const r6 = await adapter.runConsolidation({ candidate: g6.candidate }, cfg);
    assert.equal(r6.write_performed, false);
    assert.ok(r6.rejection_record.content.reason.toLowerCase().includes('distinct'));
  });

  await t.test('§9.3: judge verdict JSON validates; malformed -> that model counts as error (row 11)', async () => {
    for (const c of verdicts.valid) {
      assert.equal(validateVerdict(c.payload).valid, true, `${c.name} valid`);
    }
    for (const c of verdicts.malformed) {
      const r = validateVerdict(c.payload);
      assert.equal(r.valid, false, `${c.name} malformed`);
      const outcome = await adapter.judge({ candidate: { tier: 'L3', text: 'x' } }, {
        providers: { deepseek: { ...mockProvider('deepseek', c), name: 'deepseek' } },
        consensus: 'any',
      }, cfg);
      assert.equal(outcome.models?.deepseek ?? outcome.per_model?.deepseek, 'error', `${c.name} -> per-model error`);
    }
  });

  await t.test('§9.4/§9.5: judge gate scenarios with MOCK providers — consensus + cost caps (row 12)', async () => {
    for (const s of providers.scenarios) {
      const modelEntries = {};
      for (const name of s.panel) {
        const m = s.models[name];
        modelEntries[name] = {
          name,
          isEnabled: () => m.enabled,
          monthlyCostUsd: () => m.spentUsd,
          capUsd: m.capUsd,
          generate: async () => {
            if (m.response?.kind === 'error') throw new Error(m.response.message);
            if (m.response?.kind === 'malformed') return { text: JSON.stringify(findPayload(m.response.name)), usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.001 };
            if (Array.isArray(m.response_sequence)) {
              const next = m.response_sequence.shift();
              return { text: JSON.stringify(findPayload(next.name)), usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.001 };
            }
            return { text: JSON.stringify(findPayload(m.response.name)), usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.001 };
          },
        };
      }
      const out = await adapter.judge(
        { candidate: { tier: 'L3', text: 'The owner uses Vietnamese for chat.' } },
        { providers: modelEntries, consensus: s.consensus },
        { ...cfg, JUDGE_CAP_DEEPSEEK_USD: s.models.deepseek?.capUsd, JUDGE_CAP_GPT4_USD: s.models.gpt4?.capUsd ?? 10, JUDGE_CAP_GEMINI3_USD: s.models.gemini3?.capUsd ?? 10 },
      );
      assert.equal(out.gate, s.expected.gate, `scenario ${s.id}: gate`);
      assert.equal(out.write_performed, s.expected.write_performed, `scenario ${s.id}: write_performed`);
      if (s.expected.disabled_models) {
        assert.deepEqual(out.disabled_models?.sort(), s.expected.disabled_models.sort(), `scenario ${s.id}: disabled`);
      }
      if (s.expected.skipped_models) {
        for (const m of s.expected.skipped_models) assert.ok(out.skipped_models?.includes(m), `scenario ${s.id}: ${m} skipped`);
      }
      if (s.expected.reasons_include_disagreement) {
        assert.ok(JSON.stringify(out).toLowerCase().includes('disagreement'), `scenario ${s.id}: disagreement recorded`);
      }
    }
  });

  await t.test('§10.3: conflict -> supersede (valid_to set + supersede record + new block), never overwrite (row 14)', async () => {
    const c1 = conflict.cases[0];
    const out = await adapter.applyConflict(c1.incoming, { activeFacts: [{ id: 'fact_0009', text: "The owner's timezone is UTC+9." }] }, { judge: mockProvider('deepseek', c1.judge) }, cfg);
    assert.equal(out.no_in_place_overwrite, true);
    assert.equal(out.old_block.status, 'superseded');
    assert.ok(out.old_block.valid_to, 'old valid_to set');
    assert.equal(out.new_block.status, 'active');
    assert.ok(out.new_block.valid_from, 'new valid_from set');
    assert.ok(out.new_block.statement.includes('UTC+11'));
    assert.equal(out.supersede_record.type, 'supersede');
    assert.equal(out.supersede_record.old_id, 'fact_0009');

    const c2 = conflict.cases[1];
    const out2 = await adapter.applyConflict(c2.incoming, { activeFacts: [{ id: 'fact_0009', text: "The owner's timezone is UTC+9." }] }, { judge: mockProvider('deepseek', c2.judge) }, cfg);
    assert.equal(out2.old_block_unchanged, true);
    assert.equal(out2.no_new_block, true);
    assert.equal(out2.rejection_record.type, 'rejection');

    // retrieval consistency: active-only by default
    const text = loadText('memory/core.md');
    assert.ok(text.includes('## fact_0009: Owner timezone UTC+9 (active)'));
    assert.ok(text.includes('## fact_0007: Owner timezone UTC+7 (superseded)'));
  });

  await t.test('§10.4: Day-30 decay — importance halved + decay record; stale at ~60 days (row 15)', async () => {
    const byId = Object.fromEntries(decay.cases.map((c) => [c.id, c]));
    const d1 = byId['d1-decay-twice-stale'];
    const r1 = await adapter.applyDecay({ fact_id: d1.fact_id, importance_before: d1.importance_before, last_observed: d1.last_observed }, cfg);
    assert.equal(r1.importance_after, d1.expected.importance_after);
    assert.equal(r1.status, 'stale');
    assert.equal(r1.hot_demoted, true);
    assert.equal(r1.decay_records, 2);
    assert.equal(r1.decay_records[0]?.content?.reason ?? r1.reason, 'day30');

    const d2 = byId['d2-decay-once-active'];
    const r2 = await adapter.applyDecay({ fact_id: d2.fact_id, importance_before: d2.importance_before, last_observed: d2.last_observed }, cfg);
    assert.equal(r2.importance_after, d2.expected.importance_after);
    assert.equal(r2.status, 'active');
    assert.equal(r2.stale, false);

    const d3 = byId['d3-fresh-no-decay'];
    const r3 = await adapter.applyDecay({ fact_id: d3.fact_id, importance_before: d3.importance_before, last_observed: d3.last_observed }, cfg);
    assert.equal(r3.decay_records, 0);
    assert.equal(r3.importance_after, d3.importance_before);
  });
});
