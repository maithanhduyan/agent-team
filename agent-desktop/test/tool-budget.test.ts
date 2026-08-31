import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMaxToolCallsPerTurn } from '../src/config.js';
import {
    DEFAULT_MAX_TOOL_CALLS_PER_TURN,
    ToolCallBudget,
    ToolCallBudgetExceededError,
} from '../src/tool-budget.js';

test('ToolCallBudget defaults to MEMORY_MAX_TOOL_CALLS_PER_TURN = 5 (spec §7.3, US-MEM-006 AC-2)', () => {
    const budget = new ToolCallBudget();
    assert.equal(budget.max, DEFAULT_MAX_TOOL_CALLS_PER_TURN);
    assert.equal(budget.max, 5);
    assert.equal(budget.used, 0);
    assert.equal(budget.remaining, 5);
    assert.ok(!budget.isExhausted());
});

test('ToolCallBudget allows `max` calls per turn, then throws (spec §7.3)', () => {
    const budget = new ToolCallBudget(2);
    budget.record();
    budget.record();
    assert.equal(budget.used, 2);
    assert.equal(budget.remaining, 0);
    assert.ok(budget.isExhausted());
    assert.throws(() => budget.record(), ToolCallBudgetExceededError);
});

test('ToolCallBudget.tryRecord returns false once exhausted (no throw)', () => {
    const budget = new ToolCallBudget(1);
    assert.equal(budget.tryRecord(), true);
    assert.equal(budget.tryRecord(), false);
    assert.ok(budget.isExhausted());
});

test('ToolCallBudget rejects non-positive max', () => {
    assert.throws(() => new ToolCallBudget(0));
    assert.throws(() => new ToolCallBudget(-1));
    assert.throws(() => new ToolCallBudget(2.5));
});

test('parseMaxToolCallsPerTurn defaults to 5 and falls back on invalid input (§11)', () => {
    assert.equal(parseMaxToolCallsPerTurn(undefined), 5);
    assert.equal(parseMaxToolCallsPerTurn('3'), 3);
    assert.equal(parseMaxToolCallsPerTurn(''), 5);
    assert.equal(parseMaxToolCallsPerTurn('abc'), 5);
    assert.equal(parseMaxToolCallsPerTurn('0'), 5);
    assert.equal(parseMaxToolCallsPerTurn('-2'), 5);
});
