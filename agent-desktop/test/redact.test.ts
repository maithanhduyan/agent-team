import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, redactJsonValue } from '../src/redact.js';

test('SEC-LOG-01: OpenAI/DeepSeek sk- keys are masked', () => {
    assert.equal(redactSecrets('key=sk-abcDEF1234567890xyz'), 'key=sk-a…0xyz (redacted)');
});

test('SEC-LOG-01: Google AIza keys are masked', () => {
    assert.equal(redactSecrets('token AIzaSyA12345678901234567890123456789012 end'), 'token AIza…9012 (redacted) end');
});

test('SEC-LOG-01 (T08): Telegram bot tokens are masked (SEC-KEY-01)', () => {
    const token = '123456789:AAH4x8cLmNoPqRsTuVwXyZ0123456789abcdefg';
    const out = redactSecrets(`call https://api.telegram.org/bot${token}/sendMessage`);
    assert.ok(!out.includes(token), 'full token must not survive redaction');
    assert.ok(out.includes('(redacted)'), 'redacted marker present');
    assert.ok(out.includes('api.telegram.org/bot'), 'URL context kept, token masked');
});

test('SEC-LOG-01 (T08): TELEGRAM_BOT_TOKEN=... assignment is masked with name kept', () => {
    const out = redactSecrets('TELEGRAM_BOT_TOKEN=123456789:AAH4x8cLmNoPqRsTuVwXyZ0123456789abcdefg');
    assert.ok(out.includes('TELEGRAM_BOT_TOKEN='), 'key name stays greppable');
    assert.ok(!out.includes('AAH4x8'), 'value masked');
});

test('redactSecrets is idempotent and safe on empty/plain strings', () => {
    assert.equal(redactSecrets(''), '');
    assert.equal(redactSecrets('plain text without secrets'), 'plain text without secrets');
    const once = redactSecrets('k=sk-abcDEF1234567890xyz');
    assert.equal(redactSecrets(once), once);
});

test('redactJsonValue redacts strings recursively, leaves others untouched', () => {
    const value = {
        url: 'https://api.telegram.org/bot123456789:AAH4x8cLmNoPqRsTuVwXyZ0123456789abcdefg/sendMessage',
        list: ['sk-abcDEF1234567890xyz', 42],
        ok: true,
    };
    const redacted = redactJsonValue(value) as typeof value;
    assert.ok(!redacted.url.includes('AAH4x8'), 'nested string redacted');
    assert.ok(!redacted.list[0].includes('abcDEF'), 'array string redacted');
    assert.equal(redacted.list[1], 42);
    assert.equal(redacted.ok, true);
});
