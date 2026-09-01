import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TelegramBridge } from '../src/telegram/bridge.js';
import { SandboxTelegramTransport, type TelegramUpdate } from '../src/telegram/transport.js';
import type { TelegramConfig } from '../src/telegram/config.js';
import { CostTracker } from '../src/costs.js';
import type { MemoryCommandDeps } from '../src/telegram/commands.js';
import { MEMORY_START, MEMORY_END } from '../src/render.js';

let seq = 0;

function makeConfig(overrides: Partial<TelegramConfig> = {}): TelegramConfig {
    return {
        botToken: '',
        notifyChatIds: ['111'],
        allowedChatIds: ['111', '222'],
        apiBase: 'https://api.telegram.org',
        pollIntervalMs: 500,
        timeoutS: 30,
        sandbox: true,
        sandboxFile: 'unused',
        maxMessageLength: 4000,
        ...overrides,
    };
}

function makeMemoryDeps(overrides: Partial<MemoryCommandDeps> = {}): MemoryCommandDeps {
    return {
        search: async (query: string) => ({
            results: [{
                id: 'fact_0001', tier: 'L3' as const, ts: '2026-09-01T00:00:00.000Z',
                provenance: 'user_stated' as const, importance: 0.9, score: 0.8,
                text: 'The owner prefers Vietnamese.',
            }],
            meta: { hits: 1, took_ms: 2 },
        }),
        grep: async () => ({ matches: [], meta: { count: 0, took_ms: 1 } }),
        hotFacts: async () => [],
        spend: () => ({
            month: '2026-09',
            providers: { deepseek: { spentUsd: 0.42, capUsd: 15, disabled: false }, 'gpt-4': { spentUsd: 0, capUsd: 10, disabled: false }, 'gemini-2.5-pro': { spentUsd: 0, capUsd: 10, disabled: false } },
        }),
        ...overrides,
    };
}

function update(id: number, chatId: string, text: string): TelegramUpdate {
    return { update_id: id, message: { message_id: id, chat: { id: chatId }, text } };
}

test('bridge: consolidation notification is sent to notify chats with spend (SEC-COST-02)', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `tg-bridge-${seq++}-`));
    const file = path.join(dir, 'sandbox.jsonl');
    t.after(() => rm(dir, { recursive: true, force: true }));

    const cost = new CostTracker(dir, { month: '2026-09' });
    await cost.load();
    const transport = new SandboxTelegramTransport({ file });
    const bridge = new TelegramBridge({
        config: makeConfig({ notifyChatIds: ['111', '222'] }),
        transport,
        memory: makeMemoryDeps(),
        costTracker: cost,
        environment: 'sandbox',
        context: 'test',
        log: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
    });

    const result = {
        runId: 'cons_test',
        cursor: { cursor_ts: '2026-09-01T00:00:00.000Z', last_processed: 'evt_1', run_records: [] },
        processed: 3, observations: 3, reflections: 1, candidates: 1,
        graduated: 1, rejected: 0, superseded: 0, decayed: 0, hot_demoted: 0,
        paused: false, errors: [], durationMs: 10,
    };
    await bridge.notifyConsolidation(result as never);

    const raw = await readFile(file, 'utf8');
    const lines = raw.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2, 'one message per notify chat');
    for (const line of lines) {
        assert.equal(line.text.includes('cons_test'), true);
        assert.equal(line.text.includes('SEC-COST-02'), true);
        assert.equal(line.text.includes('_env: sandbox · test_'), true);
    }
    assert.deepEqual(new Set(lines.map((l) => l.chat_id)), new Set(['111', '222']));
});

test('bridge: consolidation error → redacted failure notification', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `tg-bridge-${seq++}-`));
    const file = path.join(dir, 'sandbox.jsonl');
    t.after(() => rm(dir, { recursive: true, force: true }));

    const token = '123456789:AAH4x8cLmNoPqRsTuVwXyZ0123456789abcdefg';
    const cost = new CostTracker(dir, { month: '2026-09' });
    await cost.load();
    const transport = new SandboxTelegramTransport({ file });
    const bridge = new TelegramBridge({
        config: makeConfig(),
        transport,
        memory: makeMemoryDeps(),
        costTracker: cost,
        environment: 'sandbox',
        log: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
    });
    await bridge.notifyConsolidationError('cons_err', new Error(`boom ${token}`));
    const raw = await readFile(file, 'utf8');
    assert.ok(!raw.includes(token), 'no token in the outbound evidence file');
    assert.ok(raw.includes('cons_err'));
});

test('bridge: handleUpdate answers /memory commands and ignores non-allowlisted chats', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `tg-bridge-${seq++}-`));
    const file = path.join(dir, 'sandbox.jsonl');
    t.after(() => rm(dir, { recursive: true, force: true }));

    const cost = new CostTracker(dir, { month: '2026-09' });
    await cost.load();
    const transport = new SandboxTelegramTransport({ file });
    const bridge = new TelegramBridge({
        config: makeConfig({ allowedChatIds: ['111'] }),
        transport,
        memory: makeMemoryDeps(),
        costTracker: cost,
        environment: 'sandbox',
        log: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
    });

    const allowed = await bridge.handleUpdate(update(1, '111', '/memory search vietnamese'));
    assert.equal(allowed?.ignored, false);
    assert.equal(allowed?.command, 'search');
    assert.ok(allowed!.reply.includes(MEMORY_START));
    assert.ok(allowed!.reply.includes(MEMORY_END));

    const blocked = await bridge.handleUpdate(update(2, '999', '/memory search vietnamese'));
    assert.equal(blocked?.ignored, true, 'non-allowlisted chat is ignored');

    const raw = await readFile(file, 'utf8');
    const lines = raw.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1, 'only the allowed chat got a reply');
    assert.equal(lines[0].chat_id, '111');
});

test('bridge: pollOnce advances offset and handles each update once', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `tg-bridge-${seq++}-`));
    const file = path.join(dir, 'sandbox.jsonl');
    t.after(() => rm(dir, { recursive: true, force: true }));

    const cost = new CostTracker(dir, { month: '2026-09' });
    await cost.load();
    const transport = new SandboxTelegramTransport({ file });
    const bridge = new TelegramBridge({
        config: makeConfig(),
        transport,
        memory: makeMemoryDeps(),
        costTracker: cost,
        environment: 'sandbox',
        log: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
    });

    // Seed two inbound updates.
    await writeFile(file, [
        JSON.stringify(update(10, '111', '/memory search a')),
        JSON.stringify(update(11, '111', '/memory grep b')),
    ].join('\n'), 'utf8');

    assert.equal(await bridge.pollOnce(), 2);
    assert.equal(await bridge.pollOnce(), 0, 'offset advanced — no re-handling');

    const raw = await readFile(file, 'utf8');
    const outbound = raw.trim().split('\n').filter((l) => !l.includes('"update_id"'));
    assert.equal(outbound.length, 2);
});

test('bridge: isAllowedChat with empty allowlist allows all', () => {
    const bridge = new TelegramBridge({
        config: makeConfig({ allowedChatIds: [] }),
        transport: null as never,
        memory: makeMemoryDeps(),
        costTracker: null as never,
        environment: 'sandbox',
        log: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
    });
    assert.equal(bridge.isAllowedChat('anything'), true);
});
