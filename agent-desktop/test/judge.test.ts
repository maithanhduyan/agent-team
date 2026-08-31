import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeGate, validateVerdict, parseVerdictText, resolvePanel, buildJudgePrompt } from '../src/judge.js';
import type { LLMProvider, JudgeModelName } from '../src/llm-provider.js';

/** Mock provider factory (mirrors T06 mock-providers.json usage). */
function mockProvider(
    name: JudgeModelName,
    response: { kind: 'verdict' | 'malformed' | 'error'; name?: string; message?: string },
    opts: { enabled?: boolean; spentUsd?: number; capUsd?: number; sequence?: unknown[] } = {},
): LLMProvider {
    const verdicts: Record<string, unknown> = {
        approve: { verdict: 'approve', confidence: 0.92, reasons: ['grounded in 3 supporting observations'], suggested_edit: null },
        reject: { verdict: 'reject', confidence: 0.7, reasons: ['conflicts with active fact fact_0009'], suggested_edit: null },
        'revise-with-edit': {
            verdict: 'revise',
            confidence: 0.6,
            reasons: ['statement over-generalizes'],
            suggested_edit: "The owner's timezone is UTC+9 since 2026-08-29.",
        },
        'not-json': 'this is not json {verdict: approve',
        'missing-verdict': { confidence: 0.9, reasons: ['x'] },
    };
    const seq = opts.sequence ?? [];
    let seqIdx = 0;
    return {
        name,
        modelId: `${name}-model`,
        isEnabled: () => opts.enabled ?? true,
        monthlyCostUsd: async () => opts.spentUsd ?? 0,
        capUsd: opts.capUsd,
        generate: async () => {
            if (seq.length > 0) {
                const next = seq[Math.min(seqIdx++, seq.length - 1)] as { kind: string; name?: string; message?: string };
                if (next.kind === 'error') throw new Error(next.message ?? 'mock error');
                const payload = verdicts[next.name ?? 'approve'];
                return { text: JSON.stringify(payload), usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.001 };
            }
            if (response.kind === 'error') throw new Error(response.message ?? 'mock error');
            const payload = verdicts[response.name ?? 'approve'];
            return { text: JSON.stringify(payload), usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.001 };
        },
    } as unknown as LLMProvider;
}

const CANDIDATE = { tier: 'L3' as const, text: 'The owner uses Vietnamese for chat.' };

test('§9.3: validateVerdict accepts valid verdicts and rejects malformed ones', () => {
    assert.equal(validateVerdict({ verdict: 'approve', confidence: 0.92, reasons: ['a'], suggested_edit: null }).valid, true);
    assert.equal(validateVerdict({ verdict: 'revise', confidence: 0.6, reasons: ['a'], suggested_edit: 'edit' }).valid, true);
    for (const bad of [
        'not json',
        { confidence: 0.9, reasons: ['x'] },
        { verdict: 'maybe', confidence: 0.9, reasons: ['x'] },
        { verdict: 'approve', confidence: 1.5, reasons: ['x'] },
        { verdict: 'approve', confidence: 0.9, reasons: [] },
        { verdict: 'revise', confidence: 0.6, reasons: ['needs edit'], suggested_edit: null },
    ]) {
        assert.equal(validateVerdict(bad).valid, false, JSON.stringify(bad));
    }
});

test('parseVerdictText: malformed JSON or invalid shape → {ok:false}', () => {
    assert.equal(parseVerdictText('{"verdict":"approve","confidence":0.9,"reasons":["x"],"suggested_edit":null}').ok, true);
    assert.equal(parseVerdictText('nope').ok, false);
    assert.equal(parseVerdictText('{"verdict":"approve"}').ok, false);
});

test('§9.4 R-JUDGE-1: single enabled model verdict is decisive', async () => {
    const out = await judgeGate({
        candidate: CANDIDATE,
        providers: { deepseek: mockProvider('deepseek', { kind: 'verdict', name: 'approve' }) },
        consensus: 'any',
    });
    assert.equal(out.gate, 'approve');
    assert.equal(out.write_performed, true);
});

test('§9.3: malformed verdict counts as error for that model; consensus any approves via the other', async () => {
    const out = await judgeGate({
        candidate: CANDIDATE,
        providers: {
            deepseek: mockProvider('deepseek', { kind: 'verdict', name: 'approve' }),
            gpt4: mockProvider('gpt-4', { kind: 'malformed', name: 'not-json' }),
        },
        consensus: 'any',
    });
    assert.equal(out.gate, 'approve');
    assert.equal(out.write_performed, true);
    assert.equal(out.per_model['gpt-4'], 'error');
    assert.equal(out.models?.['gpt-4'] ?? out.per_model['gpt-4'], 'error');
});

test('§9.4 R-JUDGE-2: majority approve (2/3) → approve; tie → reject with disagreement', async () => {
    const approve = mockProvider('deepseek', { kind: 'verdict', name: 'approve' });
    const reject = mockProvider('gemini-3', { kind: 'verdict', name: 'reject' });

    const win = await judgeGate({
        candidate: CANDIDATE,
        providers: {
            deepseek: approve,
            gpt4: mockProvider('gpt-4', { kind: 'verdict', name: 'approve' }),
            gemini3: reject,
        },
        consensus: 'majority',
    });
    assert.equal(win.gate, 'approve');
    assert.equal(win.write_performed, true);

    const tie = await judgeGate({
        candidate: CANDIDATE,
        providers: {
            deepseek: approve,
            gpt4: mockProvider('gpt-4', { kind: 'verdict', name: 'reject' }),
            gemini3: reject,
        },
        consensus: 'majority',
    });
    assert.equal(tie.gate, 'reject');
    assert.equal(tie.write_performed, false);
    assert.ok(JSON.stringify(tie).toLowerCase().includes('disagreement'));
});

test('§9.4 R-JUDGE-4: all models fail → gate error, write NOT performed (fail-safe)', async () => {
    const out = await judgeGate({
        candidate: CANDIDATE,
        providers: {
            deepseek: mockProvider('deepseek', { kind: 'error', message: 'timeout after 30s' }),
            gpt4: mockProvider('gpt-4', { kind: 'malformed', name: 'missing-verdict' }),
        },
        consensus: 'any',
    });
    assert.equal(out.gate, 'error');
    assert.equal(out.write_performed, false);
});

test('§9.5: cost cap auto-disables a model; panel continues with the others', async () => {
    const out = await judgeGate({
        candidate: CANDIDATE,
        providers: {
            deepseek: mockProvider('deepseek', { kind: 'verdict', name: 'approve' }, { spentUsd: 15, capUsd: 15 }),
            gpt4: mockProvider('gpt-4', { kind: 'verdict', name: 'approve' }, { spentUsd: 2.5, capUsd: 10 }),
        },
        consensus: 'any',
    });
    assert.equal(out.gate, 'approve');
    assert.equal(out.write_performed, true);
    assert.deepEqual(out.disabled_models, ['deepseek']);
});

test('§9.5 / SEC-COST-01: all models capped → consolidation pauses safely', async () => {
    const out = await judgeGate({
        candidate: CANDIDATE,
        providers: {
            deepseek: mockProvider('deepseek', { kind: 'verdict', name: 'approve' }, { spentUsd: 15, capUsd: 15 }),
            gpt4: mockProvider('gpt-4', { kind: 'verdict', name: 'approve' }, { spentUsd: 10, capUsd: 10 }),
            gemini3: mockProvider('gemini-3', { kind: 'verdict', name: 'approve' }, { spentUsd: 10, capUsd: 10 }),
        },
        consensus: 'any',
    });
    assert.equal(out.gate, 'paused');
    assert.equal(out.write_performed, false);
    assert.equal(out.reason, 'all_models_capped');
});

test('§9.4 R-JUDGE-3: revise → one regeneration cycle → re-judge; second reject = reject', async () => {
    const out = await judgeGate({
        candidate: CANDIDATE,
        providers: {
            deepseek: mockProvider('deepseek', { kind: 'verdict', name: 'approve' }, {
                sequence: [
                    { kind: 'verdict', name: 'revise-with-edit' },
                    { kind: 'verdict', name: 'reject' },
                ],
            }),
        },
        consensus: 'any',
    });
    assert.equal(out.gate, 'reject');
    assert.equal(out.write_performed, false);
    assert.equal(out.regeneration_cycles, 1);
    assert.ok(out.edited_candidate.text.includes('UTC+9'));
});

test('SEC-KEY-03: model without key is skipped, not a failure', async () => {
    const out = await judgeGate({
        candidate: CANDIDATE,
        providers: {
            deepseek: mockProvider('deepseek', { kind: 'verdict', name: 'approve' }),
            gpt4: mockProvider('gpt-4', { kind: 'verdict', name: 'approve' }, { enabled: false }),
        },
        consensus: 'any',
    });
    assert.equal(out.gate, 'approve');
    assert.equal(out.write_performed, true);
    assert.deepEqual(out.skipped_models, ['gpt-4']);
});

test('judge prompt includes candidate, supporting observations, active facts and the rubric (§9.3)', () => {
    const prompt = buildJudgePrompt({
        candidate: CANDIDATE,
        supporting: [{ id: 'evt_1', text: 'owner uses vietnamese chat daily', provenance: 'user_stated' }],
        activeFacts: [{ id: 'fact_0009', statement: "The owner's timezone is UTC+9." }],
    });
    assert.ok(prompt.includes('The owner uses Vietnamese for chat.'));
    assert.ok(prompt.includes('evt_1'));
    assert.ok(prompt.includes('user_stated'));
    assert.ok(prompt.includes('fact_0009'));
    assert.ok(prompt.includes('grounded-in-evidence'));
    assert.ok(prompt.includes('no-injection'));
});

test('resolvePanel orders by JUDGE_PANEL_MODELS and skips disabled/capped models', async () => {
    const { panel, skipped, disabled } = await resolvePanel(
        {
            deepseek: mockProvider('deepseek', { kind: 'verdict', name: 'approve' }),
            gpt4: mockProvider('gpt-4', { kind: 'verdict', name: 'approve' }, { enabled: false }),
            gemini3: mockProvider('gemini-3', { kind: 'verdict', name: 'approve' }, { spentUsd: 10, capUsd: 10 }),
        },
        { panelModels: ['deepseek', 'gpt-4', 'gemini-3'] },
    );
    assert.deepEqual(panel.map((p) => p.name), ['deepseek']);
    assert.deepEqual(skipped, ['gpt-4']);
    assert.deepEqual(disabled, ['gemini-3']);
});
