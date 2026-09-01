/**
 * T12 runner config tests (TASK-9053 / Redmine #47).
 *
 * Covers the T09 §9 env surface: EVOLUTION_* defaults, the FIXED
 * SEC-GEPA-02/03 thresholds (never lowered/raised), and the shared
 * JUDGE_* panel surface.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    EVOLUTION_FITNESS_THRESHOLD_FIXED,
    EVOLUTION_MAX_SKILL_BYTES_FIXED,
    loadEvolutionConfig,
    sidecarConfigBlock,
} from '../src/config.js';
import { MemoryConfigError } from '../../../src/config.js';

const BASE = { EVOLUTION_RUNS_DIR: '/tmp/runs', EVOLUTION_SIDECAR_DIR: '/tmp/sidecar' };

test('defaults match T09 §9 / T10 §8', () => {
    const cfg = loadEvolutionConfig(BASE, '/opt/agent-desktop');
    assert.equal(cfg.skill, 'install-dsh');
    assert.equal(cfg.populationSize, 8);
    assert.equal(cfg.generations, 3);
    assert.equal(cfg.elitism, 2);
    assert.equal(cfg.fitnessTarget, EVOLUTION_FITNESS_THRESHOLD_FIXED);
    assert.equal(cfg.evalSample, 1.0);
    assert.equal(cfg.maxSkillBytes, EVOLUTION_MAX_SKILL_BYTES_FIXED);
    assert.equal(cfg.randomSeed, 42);
    assert.equal(cfg.judgePanelModels.join(','), 'deepseek');
    assert.equal(cfg.judgeConsensus, 'any');
    assert.equal(cfg.judgeCaps.deepseek, 15);
    assert.equal(cfg.judgeCaps.gpt4, 10);
    assert.equal(cfg.judgeCaps.gemini3, 10);
});

test('SEC-GEPA-03: size cap is fixed and cannot be raised', () => {
    assert.throws(
        () => loadEvolutionConfig({ ...BASE, EVOLUTION_MAX_SKILL_BYTES: '50000' }, '/opt/agent-desktop'),
        MemoryConfigError,
    );
    const cfg = loadEvolutionConfig({ ...BASE, EVOLUTION_MAX_SKILL_BYTES: '10240' }, '/opt/agent-desktop');
    assert.equal(cfg.maxSkillBytes, 10240, 'lowering below the cap is allowed');
});

test('SEC-GEPA-02: fitness floor is fixed and cannot be lowered', () => {
    assert.throws(
        () => loadEvolutionConfig({ ...BASE, EVOLUTION_FITNESS_TARGET: '0.5' }, '/opt/agent-desktop'),
        MemoryConfigError,
    );
});

test('invalid env values throw MemoryConfigError (hard error)', () => {
    assert.throws(() => loadEvolutionConfig({ ...BASE, EVOLUTION_GENERATIONS: 'abc' }, '/opt/agent-desktop'), MemoryConfigError);
    assert.throws(() => loadEvolutionConfig({ ...BASE, EVOLUTION_POPULATION_SIZE: '0' }, '/opt/agent-desktop'), MemoryConfigError);
});

test('sidecarConfigBlock is env-less (no keys)', () => {
    const cfg = loadEvolutionConfig(
        { ...BASE, EVOLUTION_LM_PROXY_URL: 'http://127.0.0.1:9999', EVOLUTION_LM_PROXY_TOKEN: 'tok' },
        '/opt/agent-desktop',
    );
    const block = sidecarConfigBlock(cfg) as Record<string, unknown>;
    assert.equal(block.population_size, 8);
    assert.equal(block.generations, 3);
    const repr = JSON.stringify(block);
    assert.ok(!repr.includes('tok'), 'proxy token must not leak into the config block');
    assert.ok(!repr.includes('DEEPSEEK'), 'no key names in the config block');
});

test('judge caps env surface (Q5 defaults 15/10/10)', () => {
    const cfg = loadEvolutionConfig(
        { ...BASE, JUDGE_CAP_DEEPSEEK_USD: '20', JUDGE_CAP_GPT4_USD: '5', JUDGE_CAP_GEMINI3_USD: '8' },
        '/opt/agent-desktop',
    );
    assert.equal(cfg.judgeCaps.deepseek, 20);
    assert.equal(cfg.judgeCaps.gpt4, 5);
    assert.equal(cfg.judgeCaps.gemini3, 8);
});

test('judge panel models parsed in priority order', () => {
    const cfg = loadEvolutionConfig(
        { ...BASE, JUDGE_PANEL_MODELS: 'gemini-2.5-pro,deepseek,gpt-4' },
        '/opt/agent-desktop',
    );
    assert.deepEqual(cfg.judgePanelModels, ['gemini-2.5-pro', 'deepseek', 'gpt-4']);
});
