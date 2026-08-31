import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    CoreWriter,
    parseCoreMd,
    serializeCoreMd,
    nextFactNumber,
    formatFactId,
    ConsolidationOnlyError,
    FactBlockError,
} from '../src/core-writer.js';
import type { CoreMdDocument, FactBlock } from '../src/types.js';

let seq = 0;
async function makeWriter() {
    const dir = await mkdtemp(path.join(tmpdir(), `mem-l3-${seq++}-`));
    return { dir, writer: new CoreWriter(dir) };
}

const CONS: { runId: string } = { runId: 'cons_00000000-0000-4000-8000-000000000001' };

function newFact(overrides: Partial<Parameters<CoreWriter['appendFact']>[1]> = {}) {
    return {
        statement: 'The owner communicates with the agent in Vietnamese.',
        provenance: 'user_stated' as const,
        importance: 0.9,
        hot: true,
        source: 'telegram:chat:12345',
        supporting_observations: ['evt_a', 'evt_b', 'evt_c'],
        observation_count: 3,
        title: 'User prefers Vietnamese for chat messages',
        ...overrides,
    };
}

test('appendFact requires a consolidation context (R-CORE-1)', async (t) => {
    const { dir, writer } = await makeWriter();
    t.after(() => rm(dir, { recursive: true, force: true }));

    await assert.rejects(
        () => writer.appendFact({ runId: 'not-a-cons-id' }, newFact()),
        ConsolidationOnlyError,
    );
    await assert.rejects(
        () => writer.appendFact({} as never, newFact()),
        ConsolidationOnlyError,
    );
});

test('appendFact writes a valid §6.2 fact block and bumps the header count', async (t) => {
    const { dir, writer } = await makeWriter();
    t.after(() => rm(dir, { recursive: true, force: true }));

    const block = await writer.appendFact(CONS, newFact());
    assert.equal(block.id, 'fact_0001');
    assert.equal(block.status, 'active');
    assert.equal(block.observation_count, 3);

    const raw = await readFile(path.join(dir, 'core.md'), 'utf8');
    assert.ok(raw.includes('<!-- fact_0001 -->'));
    assert.ok(raw.includes('## fact_0001: User prefers Vietnamese for chat messages'));
    assert.ok(raw.includes('- **statement:** The owner communicates with the agent in Vietnamese.'));
    assert.ok(raw.includes('- **provenance:** user_stated'));
    assert.ok(raw.includes('- **importance:** 0.9'));
    assert.ok(raw.includes('- **hot:** true'));
    assert.ok(raw.includes('- **status:** active'));
    assert.ok(raw.startsWith('---\nmemory_version: 1'));

    const doc = await writer.read();
    assert.equal(doc.header.count, 1);
    assert.equal(doc.facts.length, 1);
});

test('fact ids are a monotonic counter per file (fact_0001, fact_0002, …)', async (t) => {
    const { dir, writer } = await makeWriter();
    t.after(() => rm(dir, { recursive: true, force: true }));

    const b1 = await writer.appendFact(CONS, newFact({ statement: 'Fact one.' }));
    const b2 = await writer.appendFact(CONS, newFact({ statement: 'Fact two.', provenance: 'tool_output' }));
    const b3 = await writer.appendFact(CONS, newFact({ statement: 'Fact three.', provenance: 'model_inferred' }));
    assert.deepEqual([b1.id, b2.id, b3.id], ['fact_0001', 'fact_0002', 'fact_0003']);
    assert.equal(nextFactNumber([b1, b2, b3]), 4);
    assert.equal(formatFactId(12), 'fact_0012');
});

test('appendFact rejects an invalid block (missing statement, bad provenance) — §6.2', async (t) => {
    const { dir, writer } = await makeWriter();
    t.after(() => rm(dir, { recursive: true, force: true }));

    await assert.rejects(
        () => writer.appendFact(CONS, newFact({ statement: '   ' })),
        FactBlockError,
    );
    await assert.rejects(
        () => writer.appendFact(CONS, newFact({ provenance: 'garbage' as never })),
        FactBlockError,
    );
    await assert.rejects(
        () => writer.appendFact(CONS, newFact({ importance: 5 })),
        FactBlockError,
    );
});

test('core.md round-trips: serialize -> parse preserves all fact fields (§6.2)', async (t) => {
    const { dir, writer } = await makeWriter();
    t.after(() => rm(dir, { recursive: true, force: true }));

    const b1 = await writer.appendFact(CONS, newFact());
    const b2 = await writer.appendFact(CONS, newFact({
        statement: 'Install script must handle EFS-encrypted directories.',
        provenance: 'tool_output',
        importance: 0.8,
        hot: false,
        source: 'tool:sandbox-test:efs-case',
        supporting_observations: ['evt_d', 'evt_e'],
        observation_count: 2,
        title: 'EFS handling in install script',
    }));

    const raw = await readFile(path.join(dir, 'core.md'), 'utf8');
    const parsed = parseCoreMd(raw);
    assert.equal(parsed.header.count, 2);
    assert.equal(parsed.facts.length, 2);
    assert.deepEqual(parsed.facts[0], b1);
    assert.deepEqual(parsed.facts[1], b2);

    // Deterministic serialization.
    const doc: CoreMdDocument = { header: parsed.header, facts: parsed.facts };
    assert.equal(serializeCoreMd(doc), raw);
});

test('parseCoreMd errors on a fact block missing a required key (§13, §6.2)', () => {
    const content = [
        '---',
        'memory_version: 1',
        'updated: 2026-09-01T12:34:56.789Z',
        'count: 1',
        '---',
        '',
        '# Core Memory',
        '',
        '<!-- fact_0001 -->',
        '## fact_0001: Missing keys',
        '',
        '- **statement:** only statement here',
        '- **provenance:** user_stated',
        '',
    ].join('\n');
    assert.throws(() => parseCoreMd(content), FactBlockError);
});

test('parseCoreMd errors on a malformed fact id (fact_b0001 — not fact_<n>) — §4.2/§6.2', () => {
    const content = [
        '---',
        'memory_version: 1',
        'updated: 2026-09-01T12:34:56.789Z',
        'count: 1',
        '---',
        '',
        '# Core Memory',
        '',
        '<!-- fact_b0001 -->',
        '## fact_b0001: Wrong-format id',
        '',
        '- **statement:** id format must be fact_<n>, but the block otherwise has every key',
        '- **provenance:** user_stated',
        '- **importance:** 0.9',
        '- **hot:** true',
        '- **valid_from:** 2026-08-01T08:00:00.000Z',
        '- **valid_to:**',
        '- **source:** telegram:chat:12345',
        '- **supporting_observations:** evt_a1b2c3d4e5f60002',
        '- **observation_count:** 3',
        '- **last_observed:** 2026-08-31T12:00:00.000Z',
        '- **status:** active',
        '',
    ].join('\n');
    // Never a silent skip: the malformed id must raise, not parse to 0 facts.
    assert.throws(() => parseCoreMd(content), FactBlockError);
    assert.throws(() => parseCoreMd(content), /invalid fact id "fact_b0001"/);
});

test('parseCoreMd errors on the T06 core-broken.md fixture (id fact_b0001) — §13 row 4', async () => {
    const fixture = new URL('../tests/fixtures/memory/core-broken.md', import.meta.url);
    const content = await readFile(fixture, 'utf8');
    // The broken fixture (id `fact_b0001`, missing required key) must raise
    // a parse error — the file must never parse to 0 facts with no error.
    assert.throws(() => parseCoreMd(content), FactBlockError);
    assert.throws(() => parseCoreMd(content), /fact_b0001/);
});

test('supersedeFact sets valid_to + status superseded and appends a new block (R-CORE-3)', async (t) => {
    const { dir, writer } = await makeWriter();
    t.after(() => rm(dir, { recursive: true, force: true }));

    const old = await writer.appendFact(CONS, newFact());
    const { superseded, created } = await writer.supersedeFact(
        CONS,
        old.id,
        newFact({ statement: 'The owner now prefers English.', title: 'Owner prefers English' }),
        '2026-09-05T00:00:00.000Z',
    );
    assert.equal(superseded.status, 'superseded');
    assert.equal(superseded.valid_to, '2026-09-05T00:00:00.000Z');
    assert.equal(created.id, 'fact_0002');
    assert.equal(created.status, 'active');

    const doc = await writer.read();
    assert.equal(doc.facts.length, 2);
    const oldParsed = doc.facts.find((f) => f.id === old.id);
    assert.equal(oldParsed?.status, 'superseded');
    assert.equal(oldParsed?.valid_to, '2026-09-05T00:00:00.000Z');
});

test('supersedeFact rejects unknown or non-active facts', async (t) => {
    const { dir, writer } = await makeWriter();
    t.after(() => rm(dir, { recursive: true, force: true }));

    await assert.rejects(
        () => writer.supersedeFact(CONS, 'fact_9999', newFact(), '2026-09-05T00:00:00.000Z'),
        FactBlockError,
    );

    const old = await writer.appendFact(CONS, newFact());
    await writer.updateStatus(CONS, old.id, { status: 'expired', valid_to: '2026-09-04T00:00:00.000Z' });
    await assert.rejects(
        () => writer.supersedeFact(CONS, old.id, newFact(), '2026-09-05T00:00:00.000Z'),
        FactBlockError,
    );
});

test('updateStatus allows consolidation-driven decay/expiry transitions (§10.4)', async (t) => {
    const { dir, writer } = await makeWriter();
    t.after(() => rm(dir, { recursive: true, force: true }));

    const block = await writer.appendFact(CONS, newFact());
    const updated = await writer.updateStatus(CONS, block.id, { status: 'stale', valid_to: '2026-11-01T00:00:00.000Z' });
    assert.equal(updated.status, 'stale');
    assert.equal(updated.valid_to, '2026-11-01T00:00:00.000Z');
    const doc = await writer.read();
    assert.equal(doc.facts[0].status, 'stale');
});

test('concurrent writers are excluded by the lock (REQUIREMENTS.md gap 3)', async (t) => {
    const { dir, writer } = await makeWriter();
    t.after(() => rm(dir, { recursive: true, force: true }));

    const b1 = await writer.appendFact(CONS, newFact());
    assert.equal(b1.id, 'fact_0001');

    // A second writer instance to the same dir must not clobber.
    const writer2 = new CoreWriter(dir);
    const b2 = await writer2.appendFact(CONS, newFact({ statement: 'Second writer fact.' }));
    assert.equal(b2.id, 'fact_0002');

    const doc = await writer.read();
    assert.equal(doc.facts.length, 2);
    assert.equal(doc.facts[0].statement, 'The owner communicates with the agent in Vietnamese.');
    assert.equal(doc.facts[1].statement, 'Second writer fact.');
});

test('read() returns an empty document when core.md does not exist yet', async (t) => {
    const { dir, writer } = await makeWriter();
    t.after(() => rm(dir, { recursive: true, force: true }));
    const doc = await writer.read();
    assert.equal(doc.facts.length, 0);
    assert.equal(doc.header.count, 0);
});
