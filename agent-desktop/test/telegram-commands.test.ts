import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    executeMemoryCommand,
    memoryHelpText,
    parseMemoryCommand,
    formatSpendReport,
    type MemoryCommandDeps,
} from '../src/telegram/commands.js';
import { MEMORY_START, MEMORY_END, DATA_NOT_INSTRUCTIONS_NOTE } from '../src/render.js';
import type { CostMonthFile } from '../src/costs.js';

let seq = 0;

test('parseMemoryCommand: slash, @bot, bare prefix, unknown → help', () => {
    assert.deepEqual(parseMemoryCommand('/memory search foo'), { name: 'search', arg: 'foo' });
    assert.deepEqual(parseMemoryCommand('/memory@MyBot grep pattern here'), { name: 'grep', arg: 'pattern here' });
    assert.deepEqual(parseMemoryCommand('memory hot'), { name: 'hot', arg: '' });
    assert.deepEqual(parseMemoryCommand('/memory spend'), { name: 'spend', arg: '' });
    assert.deepEqual(parseMemoryCommand('/memory HELP'), { name: 'help', arg: '' });
    assert.deepEqual(parseMemoryCommand('/memory nope x'), { name: 'help', arg: '' });
    assert.deepEqual(parseMemoryCommand('hello there'), { name: 'help', arg: '' });
    assert.deepEqual(parseMemoryCommand(''), { name: 'help', arg: '' });
});

test('executeMemoryCommand: search renders through SEC-MEM-01 envelope (data, not instructions)', async () => {
    const deps: MemoryCommandDeps = {
        search: async () => ({
            results: [
                {
                    id: 'fact_0001', tier: 'L3', ts: '2026-09-01T00:00:00.000Z',
                    provenance: 'user_stated', importance: 0.9, score: 0.8,
                    text: 'The owner prefers Vietnamese.',
                },
            ],
            meta: { hits: 1, took_ms: 2 },
        }),
        grep: async () => ({ matches: [], meta: { count: 0, took_ms: 1 } }),
        hotFacts: async () => [],
        spend: () => makeSpend(),
    };
    const reply = await executeMemoryCommand({ name: 'search', arg: 'vietnamese' }, deps);
    assert.ok(reply.includes('search_memory "vietnamese" — 1 hit(s)'));
    assert.ok(reply.includes(MEMORY_START), 'SEC-MEM-01 envelope present');
    assert.ok(reply.includes(MEMORY_END));
    assert.ok(reply.includes(DATA_NOT_INSTRUCTIONS_NOTE));
    assert.ok(reply.includes('fact_0001'));
});

test('executeMemoryCommand: grep renders matches through the envelope', async () => {
    const deps: MemoryCommandDeps = {
        search: async () => ({ results: [], meta: { hits: 0, took_ms: 1 } }),
        grep: async () => ({
            matches: [{ file: 'sessions.jsonl', line: 3, text: 'EFS-encrypted dir', ts: null, before: [], after: [] }],
            meta: { count: 1, took_ms: 1 },
        }),
        hotFacts: async () => [],
        spend: () => makeSpend(),
    };
    const reply = await executeMemoryCommand({ name: 'grep', arg: 'EFS' }, deps);
    assert.ok(reply.includes('grep_logs "EFS" — 1 match(es)'));
    assert.ok(reply.includes(MEMORY_START));
    assert.ok(reply.includes('sessions.jsonl:3'));
});

test('executeMemoryCommand: hot facts rendered via renderHotFacts', async () => {
    const deps: MemoryCommandDeps = {
        search: async () => ({ results: [], meta: { hits: 0, took_ms: 1 } }),
        grep: async () => ({ matches: [], meta: { count: 0, took_ms: 1 } }),
        hotFacts: async () => [
            { id: 'fact_0001', statement: 'Owner speaks Vietnamese.', provenance: 'user_stated', importance: 0.9, valid_from: null },
        ],
        spend: () => makeSpend(),
    };
    const reply = await executeMemoryCommand({ name: 'hot', arg: '' }, deps);
    assert.ok(reply.includes('Hot facts (1)'));
    assert.ok(reply.includes(MEMORY_START));
    assert.ok(reply.includes('fact_0001'));
});

test('executeMemoryCommand: empty search/grep → usage; spend → report without keys', async () => {
    const deps: MemoryCommandDeps = {
        search: async () => ({ results: [], meta: { hits: 0, took_ms: 1 } }),
        grep: async () => ({ matches: [], meta: { count: 0, took_ms: 1 } }),
        hotFacts: async () => [],
        spend: () => makeSpend(),
    };
    assert.equal(await executeMemoryCommand({ name: 'search', arg: '' }, deps), 'Usage: /memory search <query>');
    assert.equal(await executeMemoryCommand({ name: 'grep', arg: '' }, deps), 'Usage: /memory grep <pattern>');

    const spendReply = await executeMemoryCommand({ name: 'spend', arg: '' }, deps);
    assert.ok(spendReply.includes('deepseek: $0.4200 / cap $15.00'));
    assert.ok(!spendReply.includes('API_KEY') && !spendReply.includes('sk-'), 'no keys in spend report');
});

test('executeMemoryCommand: no matches → informative empty reply, not an error', async () => {
    const deps: MemoryCommandDeps = {
        search: async () => ({ results: [], meta: { hits: 0, took_ms: 1 } }),
        grep: async () => ({ matches: [], meta: { count: 0, took_ms: 1 } }),
        hotFacts: async () => [],
        spend: () => makeSpend(),
    };
    const reply = await executeMemoryCommand({ name: 'search', arg: 'zzz' }, deps);
    assert.ok(reply.includes('No memory matches for "zzz".'));
});

test('executeMemoryCommand: reply truncated to maxMessageLength', async () => {
    const long = Array.from({ length: 50 }, (_, i) => `line ${i}: The owner prefers Vietnamese chat messages.`).join('\n');
    const deps: MemoryCommandDeps = {
        search: async () => ({
            results: [{
                id: 'fact_1', tier: 'L3', ts: '2026-09-01T00:00:00.000Z',
                provenance: 'user_stated', importance: 0.9, score: 0.9, text: long,
            }],
            meta: { hits: 1, took_ms: 1 },
        }),
        grep: async () => ({ matches: [], meta: { count: 0, took_ms: 1 } }),
        hotFacts: async () => [],
        spend: () => makeSpend(),
        maxMessageLength: 200,
    };
    const reply = await executeMemoryCommand({ name: 'search', arg: 'vietnamese' }, deps);
    assert.ok(reply.length <= 200, `reply ${reply.length} exceeds cap`);
    assert.ok(reply.endsWith('...'));
});

test('memoryHelpText lists the command surface and SEC-MEM note', () => {
    const help = memoryHelpText();
    assert.ok(help.includes('/memory search'));
    assert.ok(help.includes('/memory grep'));
    assert.ok(help.includes('/memory hot'));
    assert.ok(help.includes('/memory spend'));
    assert.ok(help.includes('data, not instructions'));
});

test('formatSpendReport: per-model spend, caps, disabled flags, no keys', () => {
    const report = formatSpendReport(makeSpend());
    assert.ok(report.includes('2026-09'));
    assert.ok(report.includes('deepseek: $0.4200 / cap $15.00'));
    assert.ok(report.includes('gpt-4: $0.0000 / cap $10.00 (capped/disabled)'));
    assert.ok(!report.includes('sk-'));
});

function makeSpend(): CostMonthFile {
    return {
        month: '2026-09',
        providers: {
            deepseek: { spentUsd: 0.42, capUsd: 15, disabled: false },
            'gpt-4': { spentUsd: 0, capUsd: 10, disabled: true },
            'gemini-2.5-pro': { spentUsd: 0, capUsd: 10, disabled: true },
        },
    };
}
