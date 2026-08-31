import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reflect, validateReflection, parseReflectionText, ReflectionError } from '../src/reflect.js';
import type { LLMProvider } from '../src/llm-provider.js';

function providerReturning(text: string): LLMProvider {
    return {
        name: 'deepseek',
        modelId: 'deepseek-chat',
        isEnabled: () => true,
        monthlyCostUsd: async () => 0,
        generate: async () => ({ text, usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.001 }),
    } as LLMProvider;
}

test('§8.3: a pre-shaped lesson round-trips with exactly {context, error, fix}', async () => {
    const lesson = {
        context: 'install-dsh failed on EFS-encrypted C:\\Users\\owner',
        error: 'CopyFileEx returned EFS error 1314 (missing privilege)',
        fix: 'Use raw file copy with decryption; check EFS before install',
    };
    const out = await reflect(lesson, {});
    assert.deepEqual(Object.keys(out).sort(), ['context', 'error', 'fix']);
    assert.deepEqual(out, lesson);
});

test('§8.3: a pre-shaped lesson + provider uses the provider output when parseable', async () => {
    const out = await reflect(
        { context: 'a', error: 'b', fix: 'c' },
        { provider: providerReturning('{"context":"ctx","error":"err","fix":"fx"}') },
    );
    assert.deepEqual(out, { context: 'ctx', error: 'err', fix: 'fx' });
});

test('§8.3: an unparseable provider response falls back to the validated input (shape preserved)', async () => {
    const lesson = { context: 'a', error: 'b', fix: 'c' };
    const out = await reflect(lesson, { provider: providerReturning('{"verdict":"approve"}') });
    assert.deepEqual(Object.keys(out).sort(), ['context', 'error', 'fix']);
    assert.deepEqual(out, lesson);
});

test('§8.3: missing fix → schema error mentioning the key (acceptance row 9)', async () => {
    await assert.rejects(
        () => reflect({ context: 'install failed', error: 'EFS 1314' }, {}),
        (err: unknown) => err instanceof ReflectionError && /fix|schema/i.test(err.message),
    );
});

test('§8.3: raw observations require a provider; its output must be a valid reflection', async () => {
    const out = await reflect(
        { observations: ['install-dsh failed on EFS', 'CopyFileEx error 1314', 'raw copy worked'] },
        { provider: providerReturning('{"context":"EFS install","error":"EFS 1314","fix":"use decrypted copy"}') },
    );
    assert.deepEqual(Object.keys(out).sort(), ['context', 'error', 'fix']);

    await assert.rejects(
        () => reflect({ observations: ['x'] }, { provider: providerReturning('{"verdict":"approve"}') }),
        ReflectionError,
    );
    await assert.rejects(
        () => reflect({ observations: ['x'] }, {}),
        ReflectionError,
    );
});

test('validateReflection / parseReflectionText pin the §8.3 shape', () => {
    assert.equal(validateReflection({ context: 'a', error: 'b', fix: 'c' }).ok, true);
    assert.equal(validateReflection({ context: 'a', error: 'b' }).ok, false);
    assert.equal(parseReflectionText('not json').ok, false);
    assert.equal(parseReflectionText('{"context":"a","error":"b","fix":""}').ok, false);
});
