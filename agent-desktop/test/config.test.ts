import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMemoryConfig, parseRotateMb } from '../src/config.js';
import { DEFAULT_INJECTION_PATTERNS } from '../src/injection.js';

test('loadMemoryConfig defaults (§11)', () => {
    const cfg = loadMemoryConfig({}, '/project');
    assert.equal(cfg.memoryDir, '/project/memory');
    assert.equal(cfg.rotateBytes, 100 * 1024 * 1024);
    assert.deepEqual(cfg.injectionPatterns, [...DEFAULT_INJECTION_PATTERNS]);
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

test('parseRotateMb falls back to the default on invalid input', () => {
    assert.equal(parseRotateMb('50', 100), 50);
    assert.equal(parseRotateMb('', 100), 100);
    assert.equal(parseRotateMb('abc', 100), 100);
    assert.equal(parseRotateMb('-3', 100), 100);
    assert.equal(parseRotateMb(undefined, 100), 100);
});
