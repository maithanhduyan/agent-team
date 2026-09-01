/**
 * T12 judge-team tests (TASK-9053 / Redmine #47) — Q5 / ADR-017.
 *
 * Mock-provider tests for the GEPA judge gate:
 *   - cost cap ⇒ model auto-disabled (SEC-GEPA-09 / SEC-COST-01);
 *   - all models capped ⇒ gate `paused` (never unjudged, no cap
 *     override);
 *   - DeepSeek-only default panel runs the pipeline (SEC-KEY-03 —
 *     missing keys skip, never fail);
 *   - single-model fallback verdict is decisive (R-JUDGE-1);
 *   - consensus any/majority; malformed/error verdicts count as error.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CostTracker } from '../../../src/costs.js';
import type { LLMProvider, JudgeModelName } from '../../../src/llm-provider.js';
import { judgeCandidate, buildGepaJudgePrompt, type JudgeTeamConfig } from '../src/judge-team.js';

let seq = 0;

/** Mock provider factory (mirrors the T05/T06 mock pattern). */
function mockProvider(
    name: JudgeModelName,
    response: { kind: 'verdict' | 'malformed' | 'error'; name?: string; message?: string },
    opts: { enabled?: boolean; spentUsd?: number; capUsd?: number; costUsd?: number } = {},
): LLMProvider {
    const verdicts: Record<string, unknown> = {
        approve: { verdict: 'approve', confidence: 0.92, reasons: ['preserves semantics; minimal diff; no injection'], suggested_edit: null },
        reject: { verdict: 'reject', confidence: 0.7, reasons: ['semantic drift vs base skill'], suggested_edit: null },
        revise: { verdict: 'revise', confidence: 0.6, reasons: ['diff too large'], suggested_edit: 'keep the change minimal' },
    };
    return {
        name,
        modelId: `${name}-model`,
        isEnabled: () => opts.enabled ?? true,
        monthlyCostUsd: async () => opts.spentUsd ?? 0,
        capUsd: opts.capUsd,
        generate: async () => {
            if (response.kind === 'error') throw new Error(response.message ?? 'mock error');
            const payload = response.kind === 'malformed'
                ? { confidence: 0.9, reasons: ['x'] }
                : verdicts[response.name ?? 'approve'];
            return { text: JSON.stringify(payload), usage: { inputTokens: 10, outputTokens: 20 }, costUsd: opts.costUsd ?? 0.001 };
        },
    } as unknown as LLMProvider;
}

const BASE = '# Skill: install-dsh\n\n## Install\n1. Copy payload.\n';
const CANDIDATE = '# Skill: install-dsh\n\n## Install\n1. Copy payload.\n2. Write config.\n\n## Cleanup\n- Remove artifacts.\n';

function makeCfg(over: Partial<JudgeTeamConfig> = {}): JudgeTeamConfig {
    return {
        panelModels: ['deepseek'],
        consensus: 'any',
        maxModelsPerCall: 3,
        timeoutS: 10,
        caps: { deepseek: 15, gpt4: 10, gemini3: 10 },
        ...over,
    };
}

async function makeCost(dir: string, month = '2026-09') {
    return new CostTracker(dir, { month, caps: { deepseek: 15, 'gpt-4': 10, 'gemini-3': 10 } });
}

test('R-JUDGE-1: single DeepSeek model (default panel) verdict is decisive', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), `gepa-judge-${seq++}-`));
    try {
        const cost = await makeCost(dir);
        const out = await judgeCandidate({
            candidateText: CANDIDATE,
            baseSkillText: BASE,
            fitness: { fitness: 1.0, threshold_met: true, regression_pass: true },
            cfg: makeCfg(),
            cost,
            providers: { deepseek: mockProvider('deepseek', { kind: 'verdict', name: 'approve' }) },
        });
        assert.equal(out.gate, 'approve');
        assert.equal(out.per_model.deepseek, 'approve');
        assert.equal(out.cost.providers.deepseek.spentUsd, 0.001, 'cost recorded (SEC-COST-01)');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('SEC-KEY-03: missing key (disabled provider) is skipped, not a failure', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), `gepa-judge-${seq++}-`));
    try {
        const cost = await makeCost(dir);
        // Panel asks for [deepseek, gpt-4, gemini-3] but only deepseek is
        // enabled — gpt-4/gemini-3 have no key ⇒ skipped (SEC-KEY-03).
        const out = await judgeCandidate({
            candidateText: CANDIDATE,
            baseSkillText: BASE,
            fitness: { fitness: 1.0, threshold_met: true, regression_pass: true },
            cfg: makeCfg({ panelModels: ['deepseek', 'gpt-4', 'gemini-3'] }),
            cost,
            providers: {
                deepseek: mockProvider('deepseek', { kind: 'verdict', name: 'approve' }),
                'gpt-4': mockProvider('gpt-4', { kind: 'verdict', name: 'approve' }, { enabled: false }),
                'gemini-3': mockProvider('gemini-3', { kind: 'verdict', name: 'approve' }, { enabled: false }),
            },
        });
        assert.equal(out.gate, 'approve');
        assert.deepEqual(out.skipped_models.sort(), ['gemini-3', 'gpt-4']);
        assert.equal(out.per_model['gpt-4'], undefined, 'skipped model has no verdict');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('SEC-GEPA-09: model at its monthly cap is auto-disabled (SEC-COST-01)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), `gepa-judge-${seq++}-`));
    try {
        const cost = await makeCost(dir);
        await cost.recordCost('deepseek', 15); // deepseek at cap
        const out = await judgeCandidate({
            candidateText: CANDIDATE,
            baseSkillText: BASE,
            fitness: { fitness: 1.0, threshold_met: true, regression_pass: true },
            cfg: makeCfg({ panelModels: ['deepseek', 'gpt-4'] }),
            cost,
            providers: {
                deepseek: mockProvider('deepseek', { kind: 'verdict', name: 'approve' }, { spentUsd: 15 }),
                'gpt-4': mockProvider('gpt-4', { kind: 'verdict', name: 'approve' }),
            },
        });
        // deepseek disabled at cap; gpt-4 decides (any consensus).
        assert.deepEqual(out.disabled_models, ['deepseek']);
        assert.equal(out.gate, 'approve');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('SEC-GEPA-09: ALL models capped ⇒ gate paused — no unjudged write, no cap override', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), `gepa-judge-${seq++}-`));
    try {
        const cost = await makeCost(dir);
        const out = await judgeCandidate({
            candidateText: CANDIDATE,
            baseSkillText: BASE,
            fitness: { fitness: 1.0, threshold_met: true, regression_pass: true },
            cfg: makeCfg({ panelModels: ['deepseek', 'gpt-4', 'gemini-3'] }),
            cost,
            providers: {
                deepseek: mockProvider('deepseek', { kind: 'verdict', name: 'approve' }, { spentUsd: 15, capUsd: 15 }),
                'gpt-4': mockProvider('gpt-4', { kind: 'verdict', name: 'approve' }, { spentUsd: 10, capUsd: 10 }),
                'gemini-3': mockProvider('gemini-3', { kind: 'verdict', name: 'approve' }, { spentUsd: 10, capUsd: 10 }),
            },
        });
        assert.equal(out.gate, 'paused');
        assert.equal(out.reason, 'all_models_capped');
        assert.deepEqual(out.disabled_models.sort(), ['deepseek', 'gemini-3', 'gpt-4']);
        assert.equal(out.per_model.deepseek, undefined, 'no verdict recorded when paused');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('no enabled model (all keys missing) ⇒ paused (never unjudged)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), `gepa-judge-${seq++}-`));
    try {
        const cost = await makeCost(dir);
        const out = await judgeCandidate({
            candidateText: CANDIDATE,
            baseSkillText: BASE,
            fitness: { fitness: 1.0, threshold_met: true, regression_pass: true },
            cfg: makeCfg(),
            cost,
            providers: { deepseek: mockProvider('deepseek', { kind: 'verdict', name: 'approve' }, { enabled: false }) },
        });
        assert.equal(out.gate, 'paused');
        assert.equal(out.reason, 'no_enabled_models');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('consensus=any: reject verdict ⇒ gate reject', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), `gepa-judge-${seq++}-`));
    try {
        const cost = await makeCost(dir);
        const out = await judgeCandidate({
            candidateText: CANDIDATE,
            baseSkillText: BASE,
            fitness: { fitness: 1.0, threshold_met: true, regression_pass: true },
            cfg: makeCfg(),
            cost,
            providers: { deepseek: mockProvider('deepseek', { kind: 'verdict', name: 'reject' }) },
        });
        assert.equal(out.gate, 'reject');
        assert.equal(out.per_model.deepseek, 'reject');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('consensus=majority: 1 approve / 2 reject ⇒ reject with disagreement', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), `gepa-judge-${seq++}-`));
    try {
        const cost = await makeCost(dir);
        const out = await judgeCandidate({
            candidateText: CANDIDATE,
            baseSkillText: BASE,
            fitness: { fitness: 1.0, threshold_met: true, regression_pass: true },
            cfg: makeCfg({ panelModels: ['deepseek', 'gpt-4', 'gemini-3'], consensus: 'majority' }),
            cost,
            providers: {
                deepseek: mockProvider('deepseek', { kind: 'verdict', name: 'approve' }),
                'gpt-4': mockProvider('gpt-4', { kind: 'verdict', name: 'reject' }),
                'gemini-3': mockProvider('gemini-3', { kind: 'verdict', name: 'reject' }),
            },
        });
        assert.equal(out.gate, 'reject');
        assert.equal(out.reason, 'disagreement');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('malformed verdict counts as error for that model (R-JUDGE-4)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), `gepa-judge-${seq++}-`));
    try {
        const cost = await makeCost(dir);
        const out = await judgeCandidate({
            candidateText: CANDIDATE,
            baseSkillText: BASE,
            fitness: { fitness: 1.0, threshold_met: true, regression_pass: true },
            cfg: makeCfg({ panelModels: ['deepseek', 'gpt-4'] }),
            cost,
            providers: {
                deepseek: mockProvider('deepseek', { kind: 'malformed' }),
                'gpt-4': mockProvider('gpt-4', { kind: 'verdict', name: 'approve' }),
            },
        });
        assert.equal(out.gate, 'approve', 'gpt-4 approve wins under any-consensus');
        assert.equal(out.per_model.deepseek, 'error');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('provider error counts as error; all errors ⇒ gate error (no unjudged write)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), `gepa-judge-${seq++}-`));
    try {
        const cost = await makeCost(dir);
        const out = await judgeCandidate({
            candidateText: CANDIDATE,
            baseSkillText: BASE,
            fitness: { fitness: 1.0, threshold_met: true, regression_pass: true },
            cfg: makeCfg(),
            cost,
            providers: { deepseek: mockProvider('deepseek', { kind: 'error', message: 'timeout after 10s' }) },
        });
        assert.equal(out.gate, 'error');
        assert.equal(out.reason, 'all_models_failed');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('dry-run with no enabled model does NOT pause (tests/CI)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), `gepa-judge-${seq++}-`));
    try {
        const cost = await makeCost(dir);
        const out = await judgeCandidate({
            candidateText: CANDIDATE,
            baseSkillText: BASE,
            fitness: { fitness: 1.0, threshold_met: true, regression_pass: true },
            cfg: makeCfg({ dryRun: true }),
            cost,
            providers: { deepseek: mockProvider('deepseek', { kind: 'verdict', name: 'approve' }, { enabled: false }) },
        });
        assert.equal(out.gate, 'skipped');
        assert.equal(out.reason, 'dry_run_no_models');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('GEPA judge prompt includes base skill, candidate, rubric, fitness evidence', () => {
    const prompt = buildGepaJudgePrompt({
        baseSkillText: BASE,
        candidateText: CANDIDATE,
        fitness: { fitness: 1.0, regression_pass: true },
    });
    assert.ok(prompt.includes('Base skill'));
    assert.ok(prompt.includes('Candidate SKILL.md'));
    assert.ok(prompt.includes('semantic-preservation'));
    assert.ok(prompt.includes('no-injection'));
    assert.ok(prompt.includes('fitness=1'));
    assert.ok(prompt.includes('regression_pass=true'));
    // No secrets / no key-shaped content in the prompt (SEC-KEY-02).
    assert.ok(!/sk-[A-Za-z0-9]{8,}/.test(prompt));
});
