import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    runConsolidation,
    runConsolidationJob,
    applyConflict,
    applyDecay,
    loadCursor,
    saveCursor,
    recordsSince,
    cursorAfter,
    clusterObservations,
    consolidationDue,
    normalizeConsolidationConfig,
} from '../src/consolidation.js';
import { SessionsWriter } from '../src/sessions-writer.js';
import { CoreWriter, parseCoreMd } from '../src/core-writer.js';
import { MemoryConfigError } from '../src/config.js';
import type { LLMProvider } from '../src/llm-provider.js';
import type { CandidateInput, JudgeModelName } from '../src/judge.js';
import type { L2Record } from '../src/types.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let seq = 0;
async function makeDir() {
    return mkdtemp(path.join(tmpdir(), `mem-cons-${seq++}-`));
}

function mockJudge(name: JudgeModelName, verdict: 'approve' | 'reject' = 'approve', confidence = 0.92): LLMProvider {
    return {
        name,
        modelId: `${name}-model`,
        isEnabled: () => true,
        monthlyCostUsd: async () => 0,
        generate: async () => ({
            text: JSON.stringify({
                verdict,
                confidence,
                reasons: ['mock'],
                suggested_edit: null,
            }),
            usage: { inputTokens: 1, outputTokens: 1 },
            costUsd: 0.001,
        }),
    } as unknown as LLMProvider;
}

function mockReflector(lesson: { context: string; error: string; fix: string }): LLMProvider {
    return {
        name: 'deepseek',
        modelId: 'deepseek-chat',
        isEnabled: () => true,
        monthlyCostUsd: async () => 0,
        generate: async () => ({ text: JSON.stringify(lesson), usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.001 }),
    } as unknown as LLMProvider;
}

function observation(id: string, text: string, ts: string, provenance: L2Record['provenance'] = 'user_stated'): unknown {
    return {
        id,
        ts,
        session_id: 'ses_1',
        type: 'observation',
        provenance,
        importance: 0.7,
        valid_from: ts,
        valid_to: null,
        content: { text, kind: 'preference' },
        source: { kind: 'user', ref: 'telegram:chat:12345' },
    };
}

const CFG = { MEMORY_GRADUATION_N: 3, MEMORY_DECAY_DAYS: 30, MEMORY_HOT_IMPORTANCE: 0.8, refNow: '2026-09-01T00:00:00.000Z' };

/* ------------------------------------------------------------------ */
/* Graduation rule (§8.4) — runConsolidation                           */
/* ------------------------------------------------------------------ */

test('§8.4: N=2 < 3 → rejection with "insufficient" (no judge call)', async () => {
    const r = await runConsolidation(
        {
            candidate: { tier: 'L3', text: 'The owner prefers tea over coffee.', supporting_ids: ['evt_a', 'evt_b'] },
            judge: mockJudge('deepseek'),
        },
        CFG,
    );
    assert.equal(r.write_performed, false);
    assert.equal(r.outcome, 'rejection');
    assert.ok(r.rejection_record!.type === 'rejection');
    assert.ok(r.rejection_record!.content.reason.toLowerCase().includes('insufficient'));
});

test('§8.4: N=3 + judge approve → graduation with observation_count=3, active', async () => {
    const r = await runConsolidation(
        {
            candidate: { tier: 'L3', text: 'The owner uses Vietnamese for chat.', supporting_ids: ['evt_a', 'evt_b', 'evt_c'] },
            judge: mockJudge('deepseek'),
        },
        CFG,
    );
    assert.equal(r.write_performed, true);
    assert.equal(r.outcome, 'graduation');
    assert.equal(r.l3_block!.observation_count, 3);
    assert.equal(r.l3_block!.status, 'active');
});

test('§8.4: N=5 (upper bound) → graduation with observation_count=5', async () => {
    const r = await runConsolidation(
        {
            candidate: { tier: 'L3', text: 'The owner uses Vietnamese for chat.', supporting_ids: ['evt_a', 'evt_b', 'evt_c', 'evt_d', 'evt_e'] },
            judge: mockJudge('deepseek'),
        },
        CFG,
    );
    assert.equal(r.write_performed, true);
    assert.equal(r.l3_block!.observation_count, 5);
});

test('§8.4: N=3 but judge rejects → rejection with "judge"', async () => {
    const r = await runConsolidation(
        {
            candidate: { tier: 'L3', text: 'The owner uses Vietnamese for chat.', supporting_ids: ['evt_a', 'evt_b', 'evt_c'] },
            judge: mockJudge('deepseek', 'reject'),
        },
        CFG,
    );
    assert.equal(r.write_performed, false);
    assert.equal(r.outcome, 'rejection');
    assert.ok(r.rejection_record!.content.reason.toLowerCase().includes('judge'));
});

test('§8.4: N=6 outside 3..5 → config error mentioning MEMORY_GRADUATION_N/3..5', async () => {
    await assert.rejects(
        () => runConsolidation({
            candidate: { tier: 'L3', text: 'x', supporting_ids: ['a', 'b', 'c', 'd', 'e', 'f'] },
        }, CFG),
        (err: unknown) => err instanceof MemoryConfigError && /MEMORY_GRADUATION_N|3\.\.5|range/i.test(err.message),
    );
});

test('§8.4: repeated supporting ids are NOT distinct → rejection with "distinct"', async () => {
    const r = await runConsolidation(
        {
            candidate: { tier: 'L3', text: 'The owner prefers tea.', supporting_ids: ['evt_a', 'evt_a', 'evt_a'] },
            judge: mockJudge('deepseek'),
        },
        CFG,
    );
    assert.equal(r.write_performed, false);
    assert.ok(r.rejection_record!.content.reason.toLowerCase().includes('distinct'));
});

test('§8.4 + §10.5: verifier rejects a candidate whose observations do not support it', async () => {
    const obs: Record<string, L2Record> = {
        evt_a: {
            id: 'evt_a', ts: '2026-08-20T00:00:00.000Z', session_id: null, type: 'observation',
            provenance: 'user_stated', importance: 0.7, valid_from: '2026-08-20T00:00:00.000Z', valid_to: null,
            content: { text: 'the nightly backup ran at 3am', kind: 'tool_result' },
            source: { kind: 'tool', ref: 'tool:backup' },
        },
    };
    const r = await runConsolidation(
        {
            candidate: { tier: 'L3', text: 'The owner prefers Vietnamese.', supporting_ids: ['evt_a', 'evt_b', 'evt_c'] },
            judge: mockJudge('deepseek'),
            observations: obs,
            activeFacts: [],
        },
        CFG,
    );
    // evt_b/evt_c missing + evt_a has no overlap → verifier rejection.
    assert.equal(r.write_performed, false);
    assert.equal(r.outcome, 'rejection');
    assert.ok(r.rejection_record!.content.reason.toLowerCase().includes('verifier'));
});

test('§8.4: memoryDir path writes the L3 block + graduation record (R-JUDGE-5)', async (t) => {
    const dir = await makeDir();
    t.after(() => rm(dir, { recursive: true, force: true }));
    const runId = 'cons_00000000-0000-4000-8000-0000000000aa';
    const r = await runConsolidation(
        {
            candidate: { tier: 'L3', text: 'The owner uses Vietnamese for chat.', supporting_ids: ['evt_a', 'evt_b', 'evt_c'] },
            judge: mockJudge('deepseek'),
            memoryDir: dir,
            runId,
        },
        CFG,
    );
    assert.equal(r.write_performed, true);
    assert.equal(r.l3_block!.id, 'fact_0001');

    const doc = await new CoreWriter(dir).read();
    assert.equal(doc.facts.length, 1);
    assert.equal(doc.facts[0].observation_count, 3);

    const { records } = await new SessionsWriter(dir).readAll();
    const graduation = records.find((rec) => rec.type === 'graduation');
    assert.ok(graduation, 'graduation L2 record written (R-JUDGE-5)');
    assert.equal(graduation!.content.fact_id, 'fact_0001');
});

/* ------------------------------------------------------------------ */
/* Conflict / supersede (§10.3) — applyConflict                        */
/* ------------------------------------------------------------------ */

test('§10.3: judge-approved supersede — old valid_to set, new block appended, supersede record, no overwrite', async () => {
    const out = await applyConflict(
        { tier: 'L3', text: "The owner's timezone is UTC+11.", supporting_ids: ['evt_x'] },
        { activeFacts: [{ id: 'fact_0009', text: "The owner's timezone is UTC+9." }] },
        { judge: mockJudge('deepseek') },
        CFG,
    );
    assert.equal(out.no_in_place_overwrite, true);
    assert.equal(out.old_block!.status, 'superseded');
    assert.ok(out.old_block!.valid_to, 'old valid_to set');
    assert.equal(out.new_block!.status, 'active');
    assert.ok(out.new_block!.valid_from, 'new valid_from set');
    assert.ok(out.new_block!.statement.includes('UTC+11'));
    assert.equal(out.supersede_record!.type, 'supersede');
    assert.equal(out.supersede_record!.content.old_id, 'fact_0009');
    assert.equal(out.supersede_record!.content.new_id, out.new_block!.id);
});

test('§10.3: judge rejects the supersede → no change + rejection record', async () => {
    const out = await applyConflict(
        { tier: 'L3', text: "The owner's timezone is UTC+11.", supporting_ids: ['evt_x'] },
        { activeFacts: [{ id: 'fact_0009', text: "The owner's timezone is UTC+9." }] },
        { judge: mockJudge('deepseek', 'reject') },
        CFG,
    );
    assert.equal(out.old_block_unchanged, true);
    assert.equal(out.no_new_block, true);
    assert.equal(out.rejection_record!.type, 'rejection');
});

test('§10.3: supersede with memoryDir actually rewrites core.md (R-CORE-3)', async (t) => {
    const dir = await makeDir();
    t.after(() => rm(dir, { recursive: true, force: true }));
    const cons = { runId: 'cons_00000000-0000-4000-8000-0000000000bb' };
    const writer = new CoreWriter(dir);
    const old = await writer.appendFact(cons, {
        statement: "The owner's timezone is UTC+9.",
        provenance: 'user_stated',
        importance: 0.8,
        source: 'telegram:chat:12345',
        supporting_observations: ['evt_1'],
        observation_count: 1,
        title: 'Owner timezone UTC+9',
    });

    const out = await applyConflict(
        { tier: 'L3', text: "The owner's timezone is UTC+11.", supporting_ids: ['evt_x'] },
        { activeFacts: [{ id: old.id, statement: "The owner's timezone is UTC+9." }], memoryDir: dir, runId: cons.runId },
        { judge: mockJudge('deepseek') },
        CFG,
    );
    assert.equal(out.new_block!.id, 'fact_0002');
    const doc = await writer.read();
    assert.equal(doc.facts.length, 2);
    const oldParsed = doc.facts.find((f) => f.id === old.id)!;
    assert.equal(oldParsed.status, 'superseded');
    assert.ok(oldParsed.valid_to);
    assert.equal(doc.facts[1].statement, "The owner's timezone is UTC+11.");
});

/* ------------------------------------------------------------------ */
/* Decay (§10.4) — applyDecay                                          */
/* ------------------------------------------------------------------ */

test('§10.4 d1: ~62 days → 2 cycles, importance halved twice (0.9 → 0.225), stale, hot demoted', () => {
    const r = applyDecay(
        { fact_id: 'fact_0005', importance_before: 0.9, last_observed: '2026-07-01T07:05:00.000Z' },
        CFG,
    );
    assert.equal(r.decay_records, 2);
    assert.equal(r.reason, 'day30');
    assert.equal(r.importance_after, 0.225);
    assert.equal(r.status, 'stale');
    assert.equal(r.stale, true);
    assert.equal(r.hot_demoted, true);
});

test('§10.4 d2: ~48 days → 1 cycle, importance halved once (0.7 → 0.35), still active', () => {
    const r = applyDecay(
        { fact_id: 'fact_0006', importance_before: 0.7, last_observed: '2026-07-15T08:00:00.000Z' },
        CFG,
    );
    assert.equal(r.decay_records, 1);
    assert.equal(r.importance_after, 0.35);
    assert.equal(r.status, 'active');
    assert.equal(r.stale, false);
});

test('§10.4 d3: fresh observation (0 days) → no decay', () => {
    const r = applyDecay(
        { fact_id: 'fact_0001', importance_before: 0.9, last_observed: '2026-08-31T12:00:00.000Z' },
        CFG,
    );
    assert.equal(r.decay_records, 0);
    assert.equal(r.importance_after, 0.9);
    assert.equal(r.status, 'active');
});

test('§10.4: importance floor is 0.1', () => {
    const r = applyDecay(
        { fact_id: 'fact_x', importance_before: 0.2, last_observed: '2026-01-01T00:00:00.000Z' },
        CFG,
    );
    assert.equal(r.importance_after, 0.1);
});

/* ------------------------------------------------------------------ */
/* Cursor (§8.1)                                                       */
/* ------------------------------------------------------------------ */

test('§8.1: cursor survives rotation — recordsSince resumes after the cursor', () => {
    const recs: L2Record[] = [
        { id: 'evt_1', ts: '2026-08-25T09:00:00.000Z', session_id: null, type: 'observation', provenance: 'user_stated', importance: 0.5, valid_from: '2026-08-25T09:00:00.000Z', valid_to: null, content: { text: 'a', kind: 'fact' }, source: { kind: 'user', ref: 'x' } },
        { id: 'evt_2', ts: '2026-08-25T09:05:00.000Z', session_id: null, type: 'observation', provenance: 'user_stated', importance: 0.5, valid_from: '2026-08-25T09:05:00.000Z', valid_to: null, content: { text: 'b', kind: 'fact' }, source: { kind: 'user', ref: 'x' } },
        { id: 'evt_3', ts: '2026-08-26T00:00:00.000Z', session_id: null, type: 'observation', provenance: 'user_stated', importance: 0.5, valid_from: '2026-08-26T00:00:00.000Z', valid_to: null, content: { text: 'c', kind: 'fact' }, source: { kind: 'user', ref: 'x' } },
    ];
    const cursor = { cursor_ts: '2026-08-25T09:05:00.000Z', last_processed: 'evt_2', run_records: ['cons_0001'] };
    const fresh = recordsSince(cursor, recs);
    assert.deepEqual(fresh.map((r) => r.id), ['evt_3']);
    const pos = cursorAfter(fresh);
    assert.equal(pos.last_processed, 'evt_3');
});

test('cursor load/save round-trips (0600 file, memory/consolidation-cursor.json)', async (t) => {
    const dir = await makeDir();
    t.after(() => rm(dir, { recursive: true, force: true }));
    await saveCursor(dir, { cursor_ts: '2026-08-25T09:05:00.000Z', last_processed: 'evt_2', run_records: ['cons_0001'] });
    const loaded = await loadCursor(dir);
    assert.equal(loaded.cursor_ts, '2026-08-25T09:05:00.000Z');
    assert.deepEqual(loaded.run_records, ['cons_0001']);
    assert.equal(await loadCursor(path.join(dir, 'nope')).then((c) => c.cursor_ts), null);
});

test('consolidationDue honors MEMORY_CONSOLIDATE_EVERY_MIN (§8.1)', () => {
    const now = new Date('2026-09-01T00:00:00.000Z');
    const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000);
    const sevenHoursAgo = new Date(now.getTime() - 7 * 60 * 60 * 1000);
    assert.equal(consolidationDue(null, now, 360), true, 'never run → due');
    assert.equal(consolidationDue(fiveHoursAgo, now, 360), false, '5h < 6h → not due');
    assert.equal(consolidationDue(sevenHoursAgo, now, 360), true, '7h >= 6h → due');
});

/* ------------------------------------------------------------------ */
/* Full job (§8.1/§8.2 pipeline)                                        */
/* ------------------------------------------------------------------ */

test('full job: reflect → graduate → write L3 + run record; idempotent re-run (cursor)', async (t) => {
    const dir = await makeDir();
    t.after(() => rm(dir, { recursive: true, force: true }));

    const sessions = new SessionsWriter(dir);
    for (const [id, text, ts] of [
        ['evt_a', 'the user prefers vietnamese for chat messages', '2026-08-30T00:00:00.000Z'],
        ['evt_b', 'owner uses vietnamese chat messages daily', '2026-08-30T01:00:00.000Z'],
        ['evt_c', 'owner uses vietnamese for chat', '2026-08-30T02:00:00.000Z'],
    ] as const) {
        await sessions.append(observation(id, text, ts));
    }

    const judge = mockJudge('deepseek');
    const reflector = mockReflector({
        context: 'owner chat language',
        error: 'none',
        fix: 'The owner uses Vietnamese for chat messages.',
    });

    const first = await runConsolidationJob({
        memoryDir: dir,
        cfg: CFG,
        providers: { deepseek: judge },
        reflector,
        now: () => new Date('2026-09-01T00:00:00.000Z'),
    });

    assert.equal(first.processed, 3);
    assert.equal(first.reflections, 1);
    assert.equal(first.graduated, 1);
    assert.equal(first.paused, false);
    assert.ok(first.runId.startsWith('cons_'));

    // L3 block written to core.md.
    const doc = await new CoreWriter(dir).read();
    assert.equal(doc.facts.length, 1);
    assert.equal(doc.facts[0].observation_count, 3);
    assert.equal(doc.facts[0].status, 'active');

    // L2 audit: reflection + graduation + consolidation run record.
    const { records } = await new SessionsWriter(dir).readAll();
    assert.ok(records.some((r) => r.type === 'reflection' && r.provenance === 'model_inferred'));
    assert.ok(records.some((r) => r.type === 'graduation'));
    const runRecord = records.find((r) => r.id === first.runId && r.type === 'consolidation');
    assert.ok(runRecord, 'cons_<uuid> run record written');
    assert.equal(runRecord!.content.status, 'ok');

    // Idempotent: a re-run processes nothing and writes no duplicate L3.
    const second = await runConsolidationJob({
        memoryDir: dir,
        cfg: CFG,
        providers: { deepseek: judge },
        reflector,
        now: () => new Date('2026-09-01T00:00:00.000Z'),
    });
    assert.equal(second.processed, 0);
    assert.equal(second.graduated, 0);
    assert.equal(second.reflections, 0);
    const doc2 = await new CoreWriter(dir).read();
    assert.equal(doc2.facts.length, 1, 'no duplicate graduation on re-run');
});

test('full job: N<3 cluster is NOT graduated (rejection recorded via rule, §8.4)', async (t) => {
    const dir = await makeDir();
    t.after(() => rm(dir, { recursive: true, force: true }));

    const sessions = new SessionsWriter(dir);
    // Two distinct observations on the same topic < N=3.
    await sessions.append(observation('evt_a', 'the user prefers vietnamese for chat messages', '2026-08-30T00:00:00.000Z'));
    await sessions.append(observation('evt_b', 'owner uses vietnamese chat messages daily', '2026-08-30T01:00:00.000Z'));

    const result = await runConsolidationJob({
        memoryDir: dir,
        cfg: CFG,
        providers: { deepseek: mockJudge('deepseek') },
        reflector: mockReflector({ context: 'c', error: 'e', fix: 'The owner uses Vietnamese for chat messages.' }),
        now: () => new Date('2026-09-01T00:00:00.000Z'),
    });
    assert.equal(result.graduated, 0);
    assert.equal(result.rejected, 0, 'N<3 cluster is skipped, not rejected');
    const doc = await new CoreWriter(dir).read();
    assert.equal(doc.facts.length, 0);
});

test('full job: all judge models capped → graduation paused safely, run record paused (SEC-COST-01)', async (t) => {
    const dir = await makeDir();
    t.after(() => rm(dir, { recursive: true, force: true }));

    const sessions = new SessionsWriter(dir);
    await sessions.append(observation('evt_a', 'the user prefers vietnamese for chat messages', '2026-08-30T00:00:00.000Z'));
    await sessions.append(observation('evt_b', 'owner uses vietnamese chat messages daily', '2026-08-30T01:00:00.000Z'));
    await sessions.append(observation('evt_c', 'owner writes in vietnamese', '2026-08-30T02:00:00.000Z'));

    const capped = {
        name: 'deepseek' as JudgeModelName,
        modelId: 'deepseek-chat',
        isEnabled: () => true,
        monthlyCostUsd: async () => 15,
        capUsd: 15,
        generate: async () => {
            throw new Error('should not be called');
        },
    } as unknown as LLMProvider;

    const result = await runConsolidationJob({
        memoryDir: dir,
        cfg: { ...CFG, JUDGE_CAP_DEEPSEEK_USD: 15 },
        providers: { deepseek: capped },
        now: () => new Date('2026-09-01T00:00:00.000Z'),
    });
    assert.equal(result.paused, true);
    assert.equal(result.graduated, 0);
    const doc = await new CoreWriter(dir).read();
    assert.equal(doc.facts.length, 0, 'no unjudged write');
    const { records } = await new SessionsWriter(dir).readAll();
    const runRecord = records.find((r) => r.id === result.runId);
    assert.equal(runRecord!.content.status, 'paused');
});

test('full job: Day-30 decay pass halves stale facts and demotes hot ones (§10.4)', async (t) => {
    const dir = await makeDir();
    t.after(() => rm(dir, { recursive: true, force: true }));

    const cons = { runId: 'cons_00000000-0000-4000-8000-0000000000cc' };
    const writer = new CoreWriter(dir, { now: () => new Date('2026-07-01T00:00:00.000Z') });
    await writer.appendFact(cons, {
        statement: 'The owner drinks tea every morning.',
        provenance: 'user_stated',
        importance: 0.9,
        hot: true,
        source: 'telegram:chat:12345',
        supporting_observations: ['evt_1'],
        observation_count: 1,
        title: 'Owner drinks tea',
    });

    const result = await runConsolidationJob({
        memoryDir: dir,
        cfg: CFG,
        providers: { deepseek: mockJudge('deepseek') },
        now: () => new Date('2026-09-01T00:00:00.000Z'),
    });
    assert.equal(result.decayed, 2, '2 decay cycles written');
    assert.equal(result.hot_demoted, 1);

    const doc = await writer.read();
    assert.equal(doc.facts[0].importance, 0.225);
    assert.equal(doc.facts[0].status, 'stale');
    assert.equal(doc.facts[0].hot, false);

    const { records } = await new SessionsWriter(dir).readAll();
    assert.equal(records.filter((r) => r.type === 'decay' && r.content.fact_id === 'fact_0001').length, 2);
    assert.equal(records.filter((r) => r.type === 'hot_demote').length, 1);
});

test('clusterObservations groups same-topic observations deterministically (stage 1)', () => {
    const recs: L2Record[] = [
        { id: 'evt_1', ts: '2026-08-30T00:00:00.000Z', session_id: 'ses_1', type: 'observation', provenance: 'user_stated', importance: 0.5, valid_from: '2026-08-30T00:00:00.000Z', valid_to: null, content: { text: 'the user prefers vietnamese for chat', kind: 'preference' }, source: { kind: 'user', ref: 'x' } },
        { id: 'evt_2', ts: '2026-08-30T01:00:00.000Z', session_id: 'ses_1', type: 'observation', provenance: 'user_stated', importance: 0.5, valid_from: '2026-08-30T01:00:00.000Z', valid_to: null, content: { text: 'user prefers vietnamese chat', kind: 'preference' }, source: { kind: 'user', ref: 'x' } },
        { id: 'evt_3', ts: '2026-08-30T02:00:00.000Z', session_id: 'ses_1', type: 'observation', provenance: 'user_stated', importance: 0.5, valid_from: '2026-08-30T02:00:00.000Z', valid_to: null, content: { text: 'backup ran at 3am successfully', kind: 'tool_result' }, source: { kind: 'tool', ref: 'x' } },
    ];
    const clusters = clusterObservations(recs);
    assert.equal(clusters.length, 2, 'vietnamese topic + backup topic');
    assert.deepEqual(clusters[0].map((r) => r.id), ['evt_1', 'evt_2']);
    assert.deepEqual(clusters[1].map((r) => r.id), ['evt_3']);
});

test('normalizeConsolidationConfig: env-style keys + MemoryConfig fields + 3..5 validation', () => {
    const cfg = normalizeConsolidationConfig({ MEMORY_GRADUATION_N: 4, MEMORY_DECAY_DAYS: 45 });
    assert.equal(cfg.graduationN, 4);
    assert.equal(cfg.decayDays, 45);
    const fromFields = normalizeConsolidationConfig({ graduationN: 5, judgeConsensus: 'majority' });
    assert.equal(fromFields.graduationN, 5);
    assert.equal(fromFields.judgeConsensus, 'majority');
    assert.throws(() => normalizeConsolidationConfig({ MEMORY_GRADUATION_N: 6 }), MemoryConfigError);
    assert.throws(() => normalizeConsolidationConfig({ MEMORY_GRADUATION_N: 2 }), MemoryConfigError);
    const defaults = normalizeConsolidationConfig({});
    assert.equal(defaults.graduationN, 3);
    assert.equal(defaults.decayDays, 30);
    assert.equal(defaults.judgePanelModels[0], 'deepseek');
});
