import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DeepSeekProvider,
    Gpt4Provider,
    Gemini25ProProvider,
    completionCostUsd,
    buildPanelFromConfig,
    registerProvider,
    clearProviders,
    getProvider,
    defaultProviders,
} from '../src/llm-provider.js';
import { CostTracker } from '../src/costs.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Mock fetch returning an OpenAI-compatible completion. */
function mockOpenAiFetch(status = 200, body?: unknown) {
    return async () => new Response(JSON.stringify(body ?? {
        choices: [{ message: { content: '{"verdict":"approve","confidence":0.9,"reasons":["ok"],"suggested_edit":null}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
    }), { status, headers: { 'Content-Type': 'application/json' } });
}

test('completionCostUsd uses the per-model price table (§9.5)', () => {
    // deepseek: 1M in * 0.27 + 1M out * 1.1 = $1.37
    assert.ok(Math.abs(completionCostUsd('deepseek', { inputTokens: 1_000_000, outputTokens: 1_000_000 }) - 1.37) < 1e-9);
    assert.equal(completionCostUsd('deepseek', { inputTokens: 0, outputTokens: 0 }), 0);
});

test('DeepSeekProvider: enabled only with a key (SEC-KEY-03)', () => {
    assert.equal(new DeepSeekProvider('deepseek-chat', { env: {} }).isEnabled(), false);
    assert.equal(new DeepSeekProvider('deepseek-chat', { env: { DEEPSEEK_API_KEY: 'sk-test1234567890' } }).isEnabled(), true);
});

test('DeepSeekProvider.generate calls the OpenAI-compatible endpoint with the key in the header only (SEC-KEY-02)', async () => {
    let called: { url: string; headers: Record<string, string>; body: string } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
        called = { url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) };
        return mockOpenAiFetch()();
    }) as typeof fetch;

    const provider = new DeepSeekProvider('deepseek-chat', {
        env: { DEEPSEEK_API_KEY: 'sk-supersecret123456' },
        fetchImpl,
    });
    const res = await provider.generate({ prompt: 'judge this' });
    assert.ok(called, 'fetch called');
    assert.equal(called!.url, 'https://api.deepseek.com/chat/completions');
    assert.equal(called!.headers['Authorization'], 'Bearer sk-supersecret123456');
    // The key never appears in the prompt/body.
    assert.ok(!called!.body.includes('sk-supersecret'));
    assert.ok(!res.text.includes('sk-supersecret'));
    assert.equal(res.usage.inputTokens, 100);
    assert.equal(res.usage.outputTokens, 50);
    assert.ok(res.costUsd > 0);
});

test('DeepSeekProvider.generate throws on HTTP error (counts as per-model error, R-JUDGE-4)', async () => {
    const provider = new DeepSeekProvider('deepseek-chat', {
        env: { DEEPSEEK_API_KEY: 'sk-test1234567890' },
        fetchImpl: mockOpenAiFetch(500, { error: { message: 'boom' } }) as typeof fetch,
    });
    await assert.rejects(() => provider.generate({ prompt: 'x' }), /HTTP 500/);
});

test('DeepSeekProvider.generate throws when disabled (no key)', async () => {
    const provider = new DeepSeekProvider('deepseek-chat', { env: {} });
    await assert.rejects(() => provider.generate({ prompt: 'x' }), /not enabled/);
});

test('Gemini25ProProvider sends the key via x-goog-api-key header, never the URL (SEC-KEY-01)', async () => {
    let called: { url: string; headers: Record<string, string> } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
        called = { url: String(url), headers: init.headers as Record<string, string> };
        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"verdict":"reject","confidence":0.5,"reasons":["x"],"suggested_edit":null}' }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const provider = new Gemini25ProProvider('gemini-2.5-pro', {
        env: { GEMINI_API_KEY: 'AIzaSecretsSecretSecret123456' },
        fetchImpl,
    });
    const res = await provider.generate({ prompt: 'x' });
    assert.ok(called);
    assert.ok(!called!.url.includes('AIzaSecrets'), 'key must not appear in the URL');
    assert.ok(
        called!.url.includes('/models/gemini-2.5-pro:generateContent'),
        'real API model id gemini-2.5-pro in the request URL (Q5, Redmine #52)',
    );
    assert.equal(called!.headers['x-goog-api-key'], 'AIzaSecretsSecretSecret123456');
    assert.equal(res.usage.outputTokens, 5);
});

test('gpt-4 provider activates only when OPENAI_API_KEY is present (Q5)', () => {
    assert.equal(new Gpt4Provider('gpt-4', { env: {} }).isEnabled(), false);
    assert.equal(new Gpt4Provider('gpt-4', { env: { OPENAI_API_KEY: 'sk-openai-1234567890' } }).isEnabled(), true);
});

test('registry + buildPanelFromConfig: missing-key models are skipped, not failures', () => {
    clearProviders();
    registerProvider(new DeepSeekProvider('deepseek-chat', { env: { DEEPSEEK_API_KEY: 'sk-test1234567890' } }));
    registerProvider(new Gpt4Provider('gpt-4', { env: {} })); // no key
    registerProvider(new Gemini25ProProvider('gemini-2.5-pro', { env: {} }));

    const panel = buildPanelFromConfig({ judgePanelModels: ['deepseek', 'gpt-4', 'gemini-2.5-pro'] }, { env: {} });
    assert.deepEqual(panel.map((p) => p.name), ['deepseek']);
    assert.equal(getProvider('deepseek')?.name, 'deepseek');
    clearProviders();
});

test('defaultProviders registers all three optional modules', () => {
    const providers = defaultProviders({ env: {} });
    assert.deepEqual(providers.map((p) => p.name), ['deepseek', 'gpt-4', 'gemini-2.5-pro']);
});

test('monthlyCostUsd reads the cost tracker (SEC-COST-01)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mem-cost-'));
    try {
        const tracker = new CostTracker(dir, { month: '2026-09' });
        await tracker.recordCost('deepseek', 3.42);
        const provider = new DeepSeekProvider('deepseek-chat', { env: { DEEPSEEK_API_KEY: 'sk-test1234567890' }, costTracker: tracker });
        assert.equal(await provider.monthlyCostUsd(), 3.42);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
