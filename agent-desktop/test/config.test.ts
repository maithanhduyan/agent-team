import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    loadMemoryConfig,
    parseHotImportance,
    parseHotMax,
    parseMaxToolCallsPerTurn,
    parseRotateMb,
    parseGraduationN,
    parseDecayDays,
    parseVerifyMinOverlap,
    parseConsolidateEveryMin,
    parseConflictOverlap,
    parseJudgePanelModels,
    parseJudgeConsensus,
    parseJudgeMaxModelsPerCall,
    parseJudgeTimeoutS,
    parseJudgeCapUsd,
    MemoryConfigError,
} from '../src/config.js';
import { DEFAULT_INJECTION_PATTERNS } from '../src/injection.js';

test('loadMemoryConfig defaults (§11)', () => {
    const cfg = loadMemoryConfig({}, '/project');
    assert.equal(cfg.memoryDir, '/project/memory');
    assert.equal(cfg.rotateBytes, 100 * 1024 * 1024);
    assert.deepEqual(cfg.injectionPatterns, [...DEFAULT_INJECTION_PATTERNS]);
    // T04 surface (§7.1/§6.3/§7.2/§7.3)
    assert.deepEqual(cfg.retrievalWeights, { alpha: 0.5, beta: 0.3, gamma: 0.2 });
    assert.equal(cfg.recencyHalfLifeDays, 30);
    assert.equal(cfg.hotImportance, 0.8);
    assert.equal(cfg.hotMax, 10);
    assert.equal(cfg.maxToolCallsPerTurn, 5);
    assert.equal(cfg.runsDir, '/project/.agent-team/runs');
    // T05 surface (§8–§10/§11)
    assert.equal(cfg.graduationN, 3);
    assert.equal(cfg.decayDays, 30);
    assert.equal(cfg.verifyMinOverlap, 0.3);
    assert.equal(cfg.consolidateEveryMin, 360);
    assert.equal(cfg.conflictOverlap, 0.5);
    assert.deepEqual(cfg.judgePanelModels, ['deepseek']);
    assert.equal(cfg.judgeConsensus, 'any');
    assert.equal(cfg.judgeMaxModelsPerCall, 3);
    assert.equal(cfg.judgeTimeoutS, 30);
    assert.deepEqual(cfg.judgeCaps, { deepseek: 15, gpt4: 10, gemini3: 10 });
});

test('loadMemoryConfig honors MEMORY_DIR / MEMORY_ROTATE_MB / MEMORY_INJECTION_PATTERNS', () => {
    const cfg = loadMemoryConfig({
        MEMORY_DIR: '/custom/mem',
        MEMORY_ROTATE_MB: '5',
        MEMORY_INJECTION_PATTERNS: 'do not tell the owner, another pattern',
    }, '/project');
    assert.equal(cfg.memoryDir, '/custom/mem');
    assert.equal(cfg.rotateBytes, 5 * 1024 * 1024);
    assert.ok(cfg.injectionPatterns.includes('do not tell the owner'));
    assert.ok(cfg.injectionPatterns.includes('another pattern'));
    // Shipped defaults are never replaced by config.
    assert.ok(cfg.injectionPatterns.includes('ignore previous instructions'));
});

test('loadMemoryConfig honors the T04 env surface (weights, half-life, hot, budget, runs dir)', () => {
    const cfg = loadMemoryConfig({
        MEMORY_ALPHA: '0.4',
        MEMORY_BETA: '0.4',
        MEMORY_GAMMA: '0.2',
        MEMORY_RECENCY_HALF_LIFE_DAYS: '45',
        MEMORY_HOT_IMPORTANCE: '0.7',
        MEMORY_HOT_MAX: '3',
        MEMORY_MAX_TOOL_CALLS_PER_TURN: '2',
        MEMORY_RUNS_DIR: '/logs/runs',
    }, '/project');
    assert.deepEqual(cfg.retrievalWeights, { alpha: 0.4, beta: 0.4, gamma: 0.2 });
    assert.equal(cfg.recencyHalfLifeDays, 45);
    assert.equal(cfg.hotImportance, 0.7);
    assert.equal(cfg.hotMax, 3);
    assert.equal(cfg.maxToolCallsPerTurn, 2);
    assert.equal(cfg.runsDir, '/logs/runs');
});

test('loadMemoryConfig throws when weights do not sum to 1 (spec §7.1)', () => {
    assert.throws(() => loadMemoryConfig({ MEMORY_ALPHA: '0.9', MEMORY_BETA: '0.3', MEMORY_GAMMA: '0.2' }, '/project'));
});

test('loadMemoryConfig honors the T05 env surface (graduation, decay, judge, caps)', () => {
    const cfg = loadMemoryConfig({
        MEMORY_GRADUATION_N: '4',
        MEMORY_DECAY_DAYS: '45',
        MEMORY_VERIFY_MIN_OVERLAP: '0.4',
        MEMORY_CONSOLIDATE_EVERY_MIN: '120',
        MEMORY_CONFLICT_OVERLAP: '0.6',
        JUDGE_PANEL_MODELS: 'deepseek,gpt-4',
        JUDGE_CONSENSUS: 'majority',
        JUDGE_MAX_MODELS_PER_CALL: '2',
        JUDGE_TIMEOUT_S: '15',
        JUDGE_CAP_DEEPSEEK_USD: '20',
        JUDGE_CAP_GPT4_USD: '12',
        JUDGE_CAP_GEMINI3_USD: '8',
    }, '/project');
    assert.equal(cfg.graduationN, 4);
    assert.equal(cfg.decayDays, 45);
    assert.equal(cfg.verifyMinOverlap, 0.4);
    assert.equal(cfg.consolidateEveryMin, 120);
    assert.equal(cfg.conflictOverlap, 0.6);
    assert.deepEqual(cfg.judgePanelModels, ['deepseek', 'gpt-4']);
    assert.equal(cfg.judgeConsensus, 'majority');
    assert.equal(cfg.judgeMaxModelsPerCall, 2);
    assert.equal(cfg.judgeTimeoutS, 15);
    assert.deepEqual(cfg.judgeCaps, { deepseek: 20, gpt4: 12, gemini3: 8 });
});

test('MEMORY_GRADUATION_N outside 3..5 is a boot-time hard error (§8.4)', () => {
    assert.throws(() => loadMemoryConfig({ MEMORY_GRADUATION_N: '2' }, '/project'), MemoryConfigError);
    assert.throws(() => loadMemoryConfig({ MEMORY_GRADUATION_N: '6' }, '/project'), MemoryConfigError);
    assert.throws(() => loadMemoryConfig({ MEMORY_GRADUATION_N: 'abc' }, '/project'), MemoryConfigError);
    assert.doesNotThrow(() => loadMemoryConfig({ MEMORY_GRADUATION_N: '5' }, '/project'));
});

test('T05 parse helpers default + fall back on invalid input (§11)', () => {
    assert.equal(parseGraduationN(undefined), 3);
    assert.equal(parseGraduationN('4'), 4);
    assert.throws(() => parseGraduationN('7'), MemoryConfigError);
    assert.equal(parseDecayDays(undefined), 30);
    assert.equal(parseDecayDays('45'), 45);
    assert.equal(parseDecayDays('abc'), 30);
    assert.equal(parseVerifyMinOverlap(undefined), 0.3);
    assert.equal(parseVerifyMinOverlap('0.4'), 0.4);
    assert.equal(parseVerifyMinOverlap('2'), 0.3);
    assert.equal(parseConsolidateEveryMin(undefined), 360);
    assert.equal(parseConsolidateEveryMin('120'), 120);
    assert.equal(parseConsolidateEveryMin('0'), 360);
    assert.equal(parseConflictOverlap(undefined), 0.5);
    assert.equal(parseConflictOverlap('0.6'), 0.6);
    assert.equal(parseConflictOverlap('-1'), 0.5);
    assert.deepEqual(parseJudgePanelModels(undefined), ['deepseek']);
    assert.deepEqual(parseJudgePanelModels('deepseek, gpt-4'), ['deepseek', 'gpt-4']);
    assert.equal(parseJudgeConsensus(undefined), 'any');
    assert.equal(parseJudgeConsensus('majority'), 'majority');
    assert.equal(parseJudgeConsensus('bogus'), 'any');
    assert.equal(parseJudgeMaxModelsPerCall(undefined), 3);
    assert.equal(parseJudgeMaxModelsPerCall('2'), 2);
    assert.equal(parseJudgeTimeoutS(undefined), 30);
    assert.equal(parseJudgeTimeoutS('15'), 15);
    assert.equal(parseJudgeCapUsd(undefined, 15), 15);
    assert.equal(parseJudgeCapUsd('20', 15), 20);
    assert.equal(parseJudgeCapUsd('abc', 15), 15);
});

test('parseRotateMb falls back to the default on invalid input', () => {
    assert.equal(parseRotateMb('50', 100), 50);
    assert.equal(parseRotateMb('', 100), 100);
    assert.equal(parseRotateMb('abc', 100), 100);
    assert.equal(parseRotateMb('-3', 100), 100);
    assert.equal(parseRotateMb(undefined, 100), 100);
});

test('parseHotImportance / parseHotMax default and fall back (§11)', () => {
    assert.equal(parseHotImportance(undefined), 0.8);
    assert.equal(parseHotImportance('0.7'), 0.7);
    assert.equal(parseHotImportance('abc'), 0.8);
    assert.equal(parseHotImportance('1.5'), 0.8);
    assert.equal(parseHotMax(undefined), 10);
    assert.equal(parseHotMax('3'), 3);
    assert.equal(parseHotMax('abc'), 10);
    assert.equal(parseHotMax('0'), 10);
});
