import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CoreWriter } from '../src/core-writer.js';
import { DEFAULT_INJECTION_PATTERNS } from '../src/injection.js';
import { DEFAULT_ALPHA, DEFAULT_BETA, DEFAULT_GAMMA, DEFAULT_HALF_LIFE_DAYS } from '../src/retrieval.js';
import { SearchMemoryError, isSearchableL2Record, searchMemory } from '../src/search-memory.js';
import { SessionsWriter } from '../src/sessions-writer.js';
import type { L2Record, L2RecordType } from '../src/types.js';

/** Fixed "now" for deterministic scoring (spec §7.1 determinism). */
const NOW = '2026-09-15T00:00:00.000Z';
const NOW_DATE = new Date(NOW);

let seq = 0;
const silentLog = { warn: () => undefined, info: () => undefined };

async function makeFixture() {
    const dir = await mkdtemp(path.join(tmpdir(), `mem-search-${seq++}-`));
    const writer = new SessionsWriter(dir, {
        rotateBytes: 100 * 1024 * 1024,
        injectionPatterns: [...DEFAULT_INJECTION_PATTERNS],
        now: () => NOW_DATE,
        log: silentLog,
    });

    const base: Omit<L2Record, 'id' | 'ts' | 'content' | 'importance' | 'provenance' | 'valid_to' | 'session_id'> = {
        type: 'observation',
        valid_from: NOW,
        source: { kind: 'user', ref: 'telegram:chat:12345' },
    };

    const records: Array<Partial<L2Record> & { id: string; ts: string; text: string }> = [
        // Vietnamese cluster
        { id: 'evt_1', ts: '2026-08-16T00:00:00.000Z', session_id: 'ses_a', provenance: 'user_stated', importance: 0.9, text: 'The owner prefers Vietnamese for chat messages.' },
        { id: 'evt_3', ts: '2026-08-01T00:00:00.000Z', session_id: 'ses_b', provenance: 'user_stated', importance: 0.6, text: 'Owner prefers Vietnamese.' },
        // EFS cluster
        { id: 'evt_2', ts: '2026-09-10T00:00:00.000Z', session_id: 'ses_a', provenance: 'tool_output', importance: 0.7, text: 'Install script failed on EFS-encrypted directories.' },
        // Unrelated
        { id: 'evt_4', ts: '2026-09-14T00:00:00.000Z', session_id: 'ses_b', provenance: 'model_inferred', importance: 0.5, text: 'Coffee brewing temperature is 93 degrees.' },
        // Expired at NOW (valid_to in the past)
        { id: 'evt_5', ts: '2026-07-01T00:00:00.000Z', session_id: 'ses_b', provenance: 'user_stated', importance: 0.8, text: 'Vietnamese lessons schedule on weekends.', valid_to: '2026-08-01T00:00:00.000Z' },
    ];

    for (const r of records) {
        const result = await writer.append({ ...base, ...r, valid_from: r.ts, content: { text: r.text, kind: 'fact' } });
        assert.equal(result.status, 'written', `fixture record ${r.id}`);
    }

    const core = new CoreWriter(dir, { now: () => NOW_DATE, log: silentLog });
    const cons = { runId: 'cons_0123456789abcdef' };
    await core.appendFact(cons, {
        statement: 'The owner communicates with the agent in Vietnamese.',
        provenance: 'user_stated',
        importance: 0.9,
        hot: true,
        source: 'telegram:chat:12345',
        supporting_observations: ['evt_1', 'evt_3'],
        observation_count: 2,
        last_observed: '2026-09-01T00:00:00.000Z',
    });
    await core.appendFact(cons, {
        statement: 'Install script must handle EFS-encrypted directories.',
        provenance: 'tool_output',
        importance: 0.8,
        hot: false,
        source: 'tool:sandbox-test:efs-case',
        supporting_observations: ['evt_2'],
        observation_count: 1,
        last_observed: '2026-09-10T00:00:00.000Z',
    });

    return { dir };
}

function opts() {
    return {
        weights: { alpha: DEFAULT_ALPHA, beta: DEFAULT_BETA, gamma: DEFAULT_GAMMA },
        halfLifeDays: DEFAULT_HALF_LIFE_DAYS,
        now: () => NOW_DATE,
    };
}

test('search_memory matches the hand-computed golden set within 1e-6 (spec §13/§7.1)', async (t) => {
    const { dir } = await makeFixture();
    t.after(() => rm(dir, { recursive: true, force: true }));

    const out = await searchMemory(dir, { query: 'owner prefers vietnamese', min_score: 0.5 }, opts());

    // Only the three Vietnamese-related active records pass min_score 0.5.
    assert.equal(out.meta.hits, 3);
    assert.deepEqual(out.results.map((r) => r.id), ['evt_3', 'evt_1', 'fact_0001']);

    // Hand-computed scores (retrieval.test.ts formula, spec §7.1):
    //   evt_3     = 0.5·sim(3/3=1) + 0.3·2^(-45/30) + 0.2·0.6  = 0.7260660171779821
    //   evt_1     = 0.5·(3/7)      + 0.3·0.5         + 0.2·0.9  = 0.5442857142857143
    //   fact_0001 = 0.5·(2/8)      + 0.3·2^(-14/30)  + 0.2·0.9  = 0.5220903856160567
    const expected = [
        { id: 'evt_3', score: 0.7260660171779821, tier: 'L2', provenance: 'user_stated' },
        { id: 'evt_1', score: 0.5442857142857143, tier: 'L2', provenance: 'user_stated' },
        { id: 'fact_0001', score: 0.5220903856160567, tier: 'L3', provenance: 'user_stated', status: 'active' },
    ];
    out.results.forEach((r, i) => {
        assert.equal(r.id, expected[i].id);
        assert.equal(r.tier, expected[i].tier);
        assert.equal(r.provenance, expected[i].provenance);
        assert.ok(Math.abs(r.score - expected[i].score) <= 1e-6, `${r.id} score ${r.score} ≈ ${expected[i].score}`);
        assert.ok(r.score >= 0 && r.score <= 1);
        if (expected[i].status) assert.equal(r.status, expected[i].status);
        assert.ok(typeof r.source === 'string' && r.source.length > 0);
        assert.match(r.ts, /^\d{4}-\d{2}-\d{2}T/);
    });
    assert.equal(out.meta.query, 'owner prefers vietnamese');
});

test('search_memory default params: ranked desc by score, deterministic output (spec §7.1)', async (t) => {
    const { dir } = await makeFixture();
    t.after(() => rm(dir, { recursive: true, force: true }));

    const first = await searchMemory(dir, { query: 'owner prefers vietnamese' }, opts());
    const second = await searchMemory(dir, { query: 'owner prefers vietnamese' }, opts());

    assert.deepEqual(second.results, first.results); // identical inputs → identical outputs
    assert.ok(first.results.length >= 3);
    assert.equal(first.results[0].id, 'evt_3'); // highest score first
    for (let i = 1; i < first.results.length; i++) {
        assert.ok(first.results[i - 1].score >= first.results[i].score, 'sorted by score desc');
    }
});

test('search_memory: active-only by default; include_expired opts in (spec §7.1)', async (t) => {
    const { dir } = await makeFixture();
    t.after(() => rm(dir, { recursive: true, force: true }));

    const active = await searchMemory(dir, { query: 'vietnamese' }, opts());
    assert.ok(!active.results.some((r) => r.id === 'evt_5'), 'expired record excluded by default');

    const withExpired = await searchMemory(dir, { query: 'vietnamese', include_expired: true }, opts());
    const expired = withExpired.results.find((r) => r.id === 'evt_5');
    assert.ok(expired, 'expired record included with include_expired: true');
    assert.equal(expired.valid_to, '2026-08-01T00:00:00.000Z');
});

test('search_memory: provenance / since / session_id / layers filters (US-MEM-003 AC-3)', async (t) => {
    const { dir } = await makeFixture();
    t.after(() => rm(dir, { recursive: true, force: true }));

    const byProvenance = await searchMemory(dir, { query: 'vietnamese', provenance: ['user_stated'] }, opts());
    assert.ok(byProvenance.results.length > 0);
    assert.ok(byProvenance.results.every((r) => r.provenance === 'user_stated'));
    assert.ok(!byProvenance.results.some((r) => r.id === 'fact_0002')); // tool_output

    const since = await searchMemory(dir, { query: 'vietnamese', since: '2026-09-01T00:00:00.000Z' }, opts());
    assert.ok(since.results.every((r) => r.ts >= '2026-09-01T00:00:00.000Z'));

    const bySession = await searchMemory(dir, { query: 'vietnamese', session_id: 'ses_a' }, opts());
    assert.ok(bySession.results.length > 0);
    assert.ok(bySession.results.every((r) => r.id === 'evt_1' || r.id === 'evt_2'));

    const l3only = await searchMemory(dir, { query: 'vietnamese', layers: ['L3'] }, opts());
    assert.ok(l3only.results.length > 0);
    assert.ok(l3only.results.every((r) => r.tier === 'L3'));
    assert.ok(l3only.results.every((r) => r.id.startsWith('fact_')));

    const l2only = await searchMemory(dir, { query: 'vietnamese', layers: ['L2'] }, opts());
    assert.ok(l2only.results.length > 0);
    assert.ok(l2only.results.every((r) => r.tier === 'L2'));

    const none = await searchMemory(dir, { query: 'vietnamese', layers: ['L3'], provenance: ['tool_output'], min_score: 0.5 }, opts());
    // fact_0002 is L3 + tool_output but does not match "vietnamese" strongly (score < 0.5)
    assert.deepEqual(none.results, []);
});

test('search_memory: top_k and min_score both apply (spec §7.1)', async (t) => {
    const { dir } = await makeFixture();
    t.after(() => rm(dir, { recursive: true, force: true }));

    const top2 = await searchMemory(dir, { query: 'vietnamese', top_k: 2 }, opts());
    assert.equal(top2.results.length, 2);

    const strict = await searchMemory(dir, { query: 'vietnamese', min_score: 0.9 }, opts());
    assert.deepEqual(strict.results, []);

    const loose = await searchMemory(dir, { query: 'vietnamese', min_score: 0.4 }, opts());
    assert.ok(loose.results.length >= 1);
    assert.ok(loose.results.every((r) => r.score >= 0.4));
});

test('search_memory: empty query / unknown layer / invalid params → error; no matches → empty (spec §7.1)', async (t) => {
    const { dir } = await makeFixture();
    t.after(() => rm(dir, { recursive: true, force: true }));

    await assert.rejects(() => searchMemory(dir, { query: '   ' }, opts()), SearchMemoryError);
    await assert.rejects(() => searchMemory(dir, { query: '!!!' }, opts()), SearchMemoryError); // tokenless
    await assert.rejects(() => searchMemory(dir, { query: 'vietnamese', layers: ['L4'] as never }, opts()), SearchMemoryError);
    await assert.rejects(() => searchMemory(dir, { query: 'vietnamese', layers: [] }, opts()), SearchMemoryError);
    await assert.rejects(() => searchMemory(dir, { query: 'vietnamese', top_k: 0 }, opts()), SearchMemoryError);
    await assert.rejects(() => searchMemory(dir, { query: 'vietnamese', top_k: 51 }, opts()), SearchMemoryError);
    await assert.rejects(() => searchMemory(dir, { query: 'vietnamese', min_score: 2 }, opts()), SearchMemoryError);
    await assert.rejects(() => searchMemory(dir, { query: 'vietnamese', since: 'not-a-date' }, opts()), SearchMemoryError);
    await assert.rejects(() => searchMemory(dir, { query: 'vietnamese', provenance: ['bogus'] as never }, opts()), SearchMemoryError);

    const none = await searchMemory(dir, { query: 'quantum zebra extraction', min_score: 0.8 }, opts());
    assert.deepEqual(none.results, []);
    assert.equal(none.meta.hits, 0);
});

test('search_memory is rotation-transparent: records in archives are found (spec §5.5)', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `mem-search-rot-${seq++}-`));
    t.after(() => rm(dir, { recursive: true, force: true }));

    const writer = new SessionsWriter(dir, {
        rotateBytes: 1, // rotate after the very first append
        injectionPatterns: [...DEFAULT_INJECTION_PATTERNS],
        now: () => NOW_DATE,
        log: silentLog,
    });
    const rec = {
        type: 'observation' as const,
        provenance: 'user_stated' as const,
        importance: 0.9,
        content: { text: 'Owner prefers Vietnamese.', kind: 'fact' as const },
        source: { kind: 'user' as const, ref: 'telegram:chat:12345' },
    };
    const r1 = await writer.append(rec);
    assert.equal(r1.status, 'written');
    // second append forces rotation of the first line into an archive
    const r2 = await writer.append({ ...rec, content: { text: 'Coffee is hot.', kind: 'fact' } });
    assert.equal(r2.status, 'written');

    const out = await searchMemory(dir, { query: 'vietnamese' }, opts());
    assert.ok(out.results.some((r) => r.id === r1.record.id), 'archived record is searchable (rotation transparent)');
});

test('search_memory L2 pool is observation-only: non-observation records never rank (Redmine #42)', async (t) => {
    const { dir } = await makeFixture();
    t.after(() => rm(dir, { recursive: true, force: true }));

    const writer = new SessionsWriter(dir, {
        rotateBytes: 100 * 1024 * 1024,
        injectionPatterns: [...DEFAULT_INJECTION_PATTERNS],
        now: () => NOW_DATE,
        log: silentLog,
    });

    const base = {
        session_id: 'ses_x' as string | null,
        provenance: 'tool_output' as const,
        importance: 0.5,
        valid_from: NOW,
        valid_to: null,
        source: { kind: 'model' as const, ref: 'model:test' },
    };

    // Administrative/audit record types that must never enter the
    // searchable pool — several carry text-bearing content, which is
    // exactly what used to let them displace observation hits.
    const nonObservations: Array<{ id: string; type: L2RecordType; content: Record<string, unknown> }> = [
        { id: 'evt_candidate', type: 'candidate', content: { tier: 'L3', text: 'the user prefers vietnamese for chat messages', supporting_ids: ['evt_1'] } },
        { id: 'evt_session_start', type: 'session_start', content: { channel: 'telegram' } },
        { id: 'evt_session_end', type: 'session_end', content: { reason: 'user', duration_s: 60 } },
        { id: 'evt_tool_call', type: 'tool_call', content: { tool: 'search_memory', args: { query: 'vietnamese' }, ok: true } },
        { id: 'evt_reflection', type: 'reflection', content: { context: 'vietnamese chat', error: 'parse', fix: 'retry' } },
        { id: 'evt_rejection', type: 'rejection', content: { tier: 'L3', text: 'owner prefers vietnamese', judge: 'deepseek', verdict: 'reject', reason: 'insufficient' } },
        { id: 'evt_graduation', type: 'graduation', content: { tier: 'L3', fact_id: 'fact_0001', judge: 'deepseek', verdict: 'approve' } },
        { id: 'evt_supersede', type: 'supersede', content: { old_id: 'fact_0001', new_id: 'fact_0002', reason: 'update' } },
        { id: 'evt_decay', type: 'decay', content: { fact_id: 'fact_0001', importance_before: 0.9, importance_after: 0.45, reason: 'day30' } },
        { id: 'evt_hot_promote', type: 'hot_promote', content: { fact_id: 'fact_0001', importance: 0.9 } },
        { id: 'evt_hot_demote', type: 'hot_demote', content: { fact_id: 'fact_0001', importance: 0.4 } },
        { id: 'evt_quarantine', type: 'quarantine', content: { reason: 'injection_pattern', text: 'owner prefers vietnamese' } },
        { id: 'evt_error', type: 'error', content: { code: 'provenance_missing', message: 'write rejected: provenance is mandatory' } },
    ];

    for (const r of nonObservations) {
        const result = await writer.append({ id: r.id, ts: '2026-09-01T00:00:00.000Z', ...base, type: r.type, content: r.content });
        assert.equal(result.status, 'written', `non-observation fixture record ${r.id} should append (schema-valid)`);
    }

    // min_score 0 + top_k 50 exposes every rankable record: any
    // non-observation record in the pool would show up here.
    const out = await searchMemory(dir, { query: 'owner prefers vietnamese', min_score: 0, top_k: 50 }, opts());
    const ids = new Set(out.results.map((r) => r.id));
    for (const r of nonObservations) {
        assert.ok(!ids.has(r.id), `${r.id} (type=${r.type}) must not appear in search_memory results`);
    }
    // observation hits still rank
    assert.ok(ids.has('evt_1'), 'observation evt_1 still ranks');
    assert.ok(ids.has('evt_3'), 'observation evt_3 still ranks');
});

test('isSearchableL2Record: only observation records with non-empty content.text are searchable (Redmine #42)', () => {
    const obs = (text?: unknown): L2Record => ({
        id: 'evt_x',
        ts: NOW,
        session_id: null,
        type: 'observation',
        provenance: 'user_stated',
        importance: 0.5,
        valid_from: NOW,
        valid_to: null,
        content: (text === undefined ? { text: 'owner prefers vietnamese', kind: 'preference' } : { text, kind: 'preference' }) as L2Record['content'],
        source: { kind: 'user', ref: 'telegram:chat:12345' },
    });

    assert.equal(isSearchableL2Record(obs()), true, 'observation with text is searchable');
    assert.equal(isSearchableL2Record(obs('  ')), false, 'observation with blank text is not searchable');
    assert.equal(isSearchableL2Record(obs('')), false, 'observation with empty text is not searchable');
    assert.equal(isSearchableL2Record(obs(42)), false, 'observation with non-string text is not searchable');
    assert.equal(isSearchableL2Record({ ...obs(), type: 'candidate' }), false, 'candidate is not searchable');
    assert.equal(isSearchableL2Record({ ...obs(), type: 'error' }), false, 'error is not searchable');
    assert.equal(isSearchableL2Record({ ...obs(), type: 'session_end' }), false, 'session_end is not searchable');
    assert.equal(isSearchableL2Record({ ...obs(), type: 'rejection' }), false, 'rejection is not searchable');
    assert.equal(isSearchableL2Record({ ...obs(), type: 'quarantine' }), false, 'quarantine is not searchable');
});
