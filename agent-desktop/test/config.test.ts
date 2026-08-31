import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    loadMemoryConfig,
    parseHotImportance,
    parseHotMax,
    parseMaxToolCallsPerTurn,
    parseRotateMb,
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
