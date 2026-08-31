import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    TelegramConfigError,
    loadTelegramConfig,
    parseChatIds,
    parsePollIntervalMs,
    parseTimeoutS,
    parseMaxMessageLength,
} from '../src/telegram/config.js';

test('sandbox-first: no env → sandbox mode (plan #22 T08 acceptance)', () => {
    const cfg = loadTelegramConfig({}, 'memory');
    assert.equal(cfg.sandbox, true);
    assert.equal(cfg.botToken, '');
    assert.deepEqual(cfg.notifyChatIds, []);
    assert.deepEqual(cfg.allowedChatIds, []);
    assert.equal(cfg.apiBase, 'https://api.telegram.org');
    assert.equal(cfg.pollIntervalMs, 2000);
    assert.equal(cfg.timeoutS, 30);
    assert.equal(cfg.sandboxFile, 'memory/telegram-sandbox.jsonl');
    assert.equal(cfg.maxMessageLength, 4000);
});

test('TELEGRAM_BOT_TOKEN alone does NOT enable live mode (sandbox-first)', () => {
    const cfg = loadTelegramConfig({ TELEGRAM_BOT_TOKEN: '123456789:AAH4x8cLmNoPqRsTuVwXyZ0123456789abcdefg' }, 'm');
    assert.equal(cfg.sandbox, true, 'token alone must keep sandbox mode');
});

test('explicit TELEGRAM_SANDBOX=0 + token → live; without token → error (SEC-KEY-01)', () => {
    assert.throws(
        () => loadTelegramConfig({ TELEGRAM_SANDBOX: '0' }, 'm'),
        TelegramConfigError,
    );
    const cfg = loadTelegramConfig(
        { TELEGRAM_SANDBOX: '0', TELEGRAM_BOT_TOKEN: '123456789:AAH4x8cLmNoPqRsTuVwXyZ0123456789abcdefg' },
        'm',
    );
    assert.equal(cfg.sandbox, false);
    assert.equal(cfg.botToken, '123456789:AAH4x8cLmNoPqRsTuVwXyZ0123456789abcdefg');
});

test('chat ids: comma-separated, allowed defaults to notify ids', () => {
    const cfg = loadTelegramConfig(
        { TELEGRAM_CHAT_ID: '111,222', TELEGRAM_BOT_TOKEN: '123456789:AAH4x8cLmNoPqRsTuVwXyZ0123456789abcdefg', TELEGRAM_SANDBOX: '0' },
        'm',
    );
    assert.deepEqual(cfg.notifyChatIds, ['111', '222']);
    assert.deepEqual(cfg.allowedChatIds, ['111', '222']);
});

test('TELEGRAM_ALLOWED_CHAT_IDS overrides the default allowlist', () => {
    const cfg = loadTelegramConfig(
        { TELEGRAM_CHAT_ID: '111', TELEGRAM_ALLOWED_CHAT_IDS: '333, 444' },
        'm',
    );
    assert.deepEqual(cfg.allowedChatIds, ['333', '444']);
});

test('parseChatIds trims and drops empties', () => {
    assert.deepEqual(parseChatIds(' a , b, , c '), ['a', 'b', 'c']);
    assert.deepEqual(parseChatIds(''), []);
    assert.deepEqual(parseChatIds(undefined), []);
});

test('numeric parsers fall back on invalid input', () => {
    assert.equal(parsePollIntervalMs('abc'), 2000);
    assert.equal(parsePollIntervalMs('50'), 2000, 'below min');
    assert.equal(parsePollIntervalMs('5000'), 5000);
    assert.equal(parseTimeoutS('0'), 30);
    assert.equal(parseTimeoutS('45'), 45);
    assert.equal(parseMaxMessageLength('99999'), 4000, 'over Telegram cap');
    assert.equal(parseMaxMessageLength('2048'), 2048);
});

test('sandbox file default honors memoryDir', () => {
    const cfg = loadTelegramConfig({}, '/data/memory');
    assert.equal(cfg.sandboxFile, '/data/memory/telegram-sandbox.jsonl');
});
