import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    HttpTelegramTransport,
    SandboxTelegramTransport,
    truncateMessage,
    type TelegramUpdate,
} from '../src/telegram/transport.js';

let seq = 0;

test('truncateMessage: under/over the Telegram cap', () => {
    assert.deepEqual(truncateMessage('short', 4000), { text: 'short', truncated: false });
    const out = truncateMessage('x'.repeat(5000), 100);
    assert.equal(out.truncated, true);
    assert.equal(out.text.length, 100);
    assert.ok(out.text.endsWith('...'));
});

test('SandboxTelegramTransport: getUpdates reads inbound JSONL with offset', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `tg-sandbox-${seq++}-`));
    const file = path.join(dir, 'telegram-sandbox.jsonl');
    t.after(() => rm(dir, { recursive: true, force: true }));
    await writeFile(file, [
        JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: '111' }, text: '/memory help' } }),
        JSON.stringify({ update_id: 2, message: { message_id: 2, chat: { id: '111' }, text: '/memory hot' } }),
        '# a comment line is skipped',
        '',
    ].join('\n'), 'utf8');

    const transport = new SandboxTelegramTransport({ file });
    assert.equal(transport.mode, 'sandbox');
    const all = await transport.getUpdates(0);
    assert.equal(all.length, 2);
    assert.deepEqual(all.map((u) => u.update_id), [1, 2]);
    const after = await transport.getUpdates(1);
    assert.deepEqual(after.map((u) => u.update_id), [2]);
});

test('SandboxTelegramTransport: sendMessage appends outbound JSONL (evidence log)', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), `tg-sandbox-${seq++}-`));
    const file = path.join(dir, 'telegram-sandbox.jsonl');
    t.after(() => rm(dir, { recursive: true, force: true }));

    const transport = new SandboxTelegramTransport({ file, now: () => new Date('2026-09-01T00:00:00.000Z') });
    await transport.sendMessage('111', 'hello');
    const raw = await readFile(file, 'utf8');
    const lines = raw.trim().split('\n');
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.chat_id, '111');
    assert.equal(parsed.text, 'hello');
    assert.equal(parsed.ts, '2026-09-01T00:00:00.000Z');
});

test('HttpTelegramTransport: builds Bot API URLs with token, never logs it, sends via fetch', async (t) => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (url: string, init: { body?: string }) => {
        calls.push({ url, body: init.body ?? '' });
        return {
            ok: true,
            json: async () => ({ ok: true, result: { message_id: 7 } }),
        } as Response;
    }) as unknown as typeof fetch;

    const token = '123456789:AAH4x8cLmNoPqRsTuVwXyZ0123456789abcdefg';
    const logged: string[] = [];
    const transport = new HttpTelegramTransport({
        botToken: token,
        apiBase: 'https://api.telegram.org',
        pollIntervalMs: 2000,
        timeoutS: 30,
        fetchImpl,
        log: { warn: (m) => logged.push(String(m)), info: () => {}, debug: () => {}, error: () => {} },
    });

    await transport.sendMessage('111', 'hi');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes(`/bot${token}/sendMessage`), 'token in URL per Bot API');
    assert.ok(calls[0].body.includes('"chat_id":"111"'));
    assert.ok(calls[0].body.includes('"text":"hi"'));

    const updates: TelegramUpdate[] = [{ update_id: 5, message: { message_id: 5, chat: { id: '1' }, text: 'x' } }];
    const fetchImpl2 = (async (url: string, init: { body?: string }) => {
        assert.ok(url.includes('/getUpdates'));
        return { ok: true, json: async () => ({ ok: true, result: updates }) } as Response;
    }) as unknown as typeof fetch;
    const t2 = new HttpTelegramTransport({ botToken: token, fetchImpl: fetchImpl2 });
    const got = await t2.getUpdates(4);
    assert.equal(got.length, 1);

    // The token must never appear in any logged line.
    for (const line of logged) {
        assert.ok(!line.includes(token), `token leaked into log: ${line}`);
    }
});

test('HttpTelegramTransport: API error message is redacted (SEC-LOG-01)', async (t) => {
    const token = '123456789:AAH4x8cLmNoPqRsTuVwXyZ0123456789abcdefg';
    const fetchImpl = (async () => {
        return {
            ok: false,
            status: 401,
            json: async () => ({ ok: false, description: `unauthorized for bot${token}` }),
        } as Response;
    }) as unknown as typeof fetch;
    const transport = new HttpTelegramTransport({ botToken: token, fetchImpl });
    await assert.rejects(
        () => transport.sendMessage('111', 'hi'),
        (err: Error) => {
            assert.ok(!err.message.includes(token), 'error message must be redacted');
            assert.ok(err.message.includes('(redacted)'), 'redaction marker present');
            return true;
        },
    );
});
