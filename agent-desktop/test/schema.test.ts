import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    validateL2Record,
    validateFactBlockMetadata,
} from '../src/schema.js';
import type { L2Record } from '../src/types.js';

function validRecord(overrides: Partial<L2Record> = {}): L2Record {
    return {
        id: 'evt_01J2X',
        ts: '2026-09-01T12:34:56.789Z',
        session_id: 'ses_01J2X',
        type: 'observation',
        provenance: 'user_stated',
        importance: 0.7,
        valid_from: '2026-09-01T12:34:56.789Z',
        valid_to: null,
        content: { text: 'The owner prefers Vietnamese.', kind: 'preference' },
        source: { kind: 'user', ref: 'telegram:chat:12345' },
        ...overrides,
    };
}

test('validateL2Record accepts a fully valid record', () => {
    const result = validateL2Record(validRecord());
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
    assert.deepEqual(result.record?.session_id, 'ses_01J2X');
});

test('validateL2Record rejects a record without provenance (R-PROV-1)', () => {
    const { provenance, ...rest } = validRecord();
    void provenance;
    const result = validateL2Record(rest);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('provenance')));
});

test('validateL2Record rejects an invalid provenance value', () => {
    const result = validateL2Record(validRecord({ provenance: 'garbage' as L2Record['provenance'] }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('provenance')));
});

test('validateL2Record rejects missing id / ts / type / source (mandatory fields §5.2)', () => {
    const noId = validRecord();
    delete (noId as Partial<L2Record>).id;
    assert.equal(validateL2Record(noId).ok, false);

    const noTs = validRecord();
    delete (noTs as Partial<L2Record>).ts;
    assert.equal(validateL2Record(noTs).ok, false);

    const noType = validRecord();
    delete (noType as Partial<L2Record>).type;
    assert.equal(validateL2Record(noType).ok, false);

    const noSource = validRecord();
    delete (noSource as Partial<L2Record>).source;
    assert.equal(validateL2Record(noSource).ok, false);
});

test('validateL2Record rejects source without a verifiable kind (§10.2.1)', () => {
    const result = validateL2Record(
        validRecord({ source: { kind: 'unknown' as never, ref: 'x' } }),
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('source.kind')));
});

test('validateL2Record rejects importance outside [0,1] (§4.2)', () => {
    assert.equal(validateL2Record(validRecord({ importance: 1.5 })).ok, false);
    assert.equal(validateL2Record(validRecord({ importance: -0.1 })).ok, false);
    assert.equal(validateL2Record(validRecord({ importance: 0 })).ok, true);
    assert.equal(validateL2Record(validRecord({ importance: 1 })).ok, true);
});

test('validateL2Record rejects a ts that is not ISO 8601 UTC (§4.2)', () => {
    const result = validateL2Record(validRecord({ ts: '2026-09-01 12:34:56' }));
    assert.equal(result.ok, false);
});

test('validateL2Record enforces per-type content required keys (§5.3)', () => {
    const obs = validateL2Record(validRecord({
        type: 'observation',
        content: { kind: 'preference' }, // missing `text`
    }));
    assert.equal(obs.ok, false);
    assert.ok(obs.errors.some((e) => e.includes('text')));

    const grad = validateL2Record(validRecord({
        type: 'graduation',
        content: { tier: 'L3' }, // missing fact_id / judge / verdict
    }));
    assert.equal(grad.ok, false);
    assert.ok(grad.errors.some((e) => e.includes('fact_id')));

    const ref = validateL2Record(validRecord({
        type: 'reflection',
        content: { context: 'a', error: 'b' }, // missing fix
    }));
    assert.equal(ref.ok, false);
    assert.ok(ref.errors.some((e) => e.includes('fix')));
});

test('validateL2Record accepts every record type with its required content keys', () => {
    const cases: Array<[L2Record['type'], Record<string, unknown>]> = [
        ['session_start', { channel: 'telegram', summary: 'hi' }],
        ['session_end', { reason: 'timeout', duration_s: 12 }],
        ['observation', { text: 'x', kind: 'user_message' }],
        ['tool_call', { tool: 'search_memory', args: { q: 'x' }, ok: true }],
        ['reflection', { context: 'a', error: 'b', fix: 'c' }],
        ['candidate', { tier: 'L3', text: 't', supporting_ids: ['evt_1'] }],
        ['graduation', { tier: 'L3', fact_id: 'fact_0001', judge: 'deepseek', verdict: 'approve' }],
        ['rejection', { tier: 'L3', text: 't', judge: 'deepseek', verdict: 'reject', reason: 'r' }],
        ['supersede', { old_id: 'fact_0001', new_id: 'fact_0002', reason: 'conflict' }],
        ['decay', { fact_id: 'fact_0001', importance_before: 0.8, importance_after: 0.4, reason: 'day30' }],
        ['hot_promote', { fact_id: 'fact_0001', importance: 0.9 }],
        ['hot_demote', { fact_id: 'fact_0001', importance: 0.3 }],
        ['quarantine', { reason: 'injection_pattern', text: 'bad', snippet: 's' }],
        ['error', { code: 'E1', message: 'm' }],
    ];
    for (const [type, content] of cases) {
        const result = validateL2Record(validRecord({ type, content: content as L2Record['content'] }));
        assert.equal(result.ok, true, `type ${type} should validate: ${result.errors.join('; ')}`);
    }
});

test('validateL2Record accepts consolidation-produced records with session_id null', () => {
    const result = validateL2Record(validRecord({
        session_id: null,
        type: 'reflection',
        content: { context: 'a', error: 'b', fix: 'c' },
    }));
    assert.equal(result.ok, true);
});

test('validateFactBlockMetadata enforces §6.2 required keys', () => {
    const validMeta = {
        statement: 'Owner prefers Vietnamese.',
        provenance: 'user_stated',
        importance: 0.9,
        hot: true,
        valid_from: '2026-09-01T10:00:00.000Z',
        valid_to: '',
        source: 'telegram:chat:12345',
        supporting_observations: 'evt_1, evt_2',
        observation_count: 3,
        last_observed: '2026-09-02T08:00:00.000Z',
        status: 'active',
    };
    assert.equal(validateFactBlockMetadata(validMeta).ok, true);

    const { statement, ...missingStatement } = validMeta;
    void statement;
    const result = validateFactBlockMetadata(missingStatement);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('statement')));

    assert.equal(
        validateFactBlockMetadata({ ...validMeta, provenance: 'nope' }).ok,
        false,
    );
    assert.equal(
        validateFactBlockMetadata({ ...validMeta, importance: 2 }).ok,
        false,
    );
    assert.equal(
        validateFactBlockMetadata({ ...validMeta, status: 'bogus' }).ok,
        false,
    );
    assert.equal(
        validateFactBlockMetadata({ ...validMeta, observation_count: -1 }).ok,
        false,
    );
});
