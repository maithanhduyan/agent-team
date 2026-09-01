import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildConsolidationNotification,
    buildConsolidationErrorNotification,
} from '../src/telegram/notify.js';
import type { ConsolidationJobResult } from '../src/consolidation.js';
import type { CostMonthFile } from '../src/costs.js';

function makeResult(overrides: Partial<ConsolidationJobResult> = {}): ConsolidationJobResult {
    return {
        runId: 'cons_1234',
        cursor: { cursor_ts: '2026-09-01T00:00:00.000Z', last_processed: 'evt_1', run_records: ['cons_1234'] },
        processed: 5,
        observations: 3,
        reflections: 1,
        candidates: 1,
        graduated: 1,
        rejected: 0,
        superseded: 0,
        decayed: 2,
        hot_demoted: 1,
        paused: false,
        errors: [],
        durationMs: 150,
        ...overrides,
    };
}

function makeSpend(): CostMonthFile {
    return {
        month: '2026-09',
        providers: {
            deepseek: { spentUsd: 0.42, capUsd: 15, disabled: false },
            'gpt-4': { spentUsd: 0, capUsd: 10, disabled: true },
            'gemini-2.5-pro': { spentUsd: 0, capUsd: 10, disabled: true },
        },
    };
}

test('buildConsolidationNotification: counts + spend report, no memory content, env footer', () => {
    const text = buildConsolidationNotification(makeResult(), makeSpend(), {
        environment: 'sandbox',
        context: 'sandbox cycle',
    });
    assert.ok(text.includes('cons_1234'));
    assert.ok(text.includes('graduated: 1'));
    assert.ok(text.includes('superseded: 0'));
    assert.ok(text.includes('decayed: 2'));
    assert.ok(text.includes('hot demoted: 1'));
    assert.ok(text.includes('deepseek: $0.4200 / cap $15.0000'));
    assert.ok(text.includes('(capped/disabled)'), 'disabled model flagged');
    assert.ok(text.includes('SEC-COST-02'), 'cost section labelled');
    assert.ok(text.includes('_env: sandbox · sandbox cycle_'), 'environment footer (acceptance 2)');
    assert.ok(!text.includes('vietnamese'), 'no memory content in notification');
});

test('buildConsolidationNotification: paused status is surfaced (SEC-COST-01)', () => {
    const text = buildConsolidationNotification(
        makeResult({ paused: true }),
        makeSpend(),
        { environment: 'sandbox' },
    );
    assert.ok(text.includes('paused (judge panel unavailable — SEC-COST-01)'));
});

test('buildConsolidationErrorNotification: redacts secrets and marks env', () => {
    const token = '123456789:AAH4x8cLmNoPqRsTuVwXyZ0123456789abcdefg';
    const text = buildConsolidationErrorNotification('cons_err', new Error(`boom ${token}`), {
        environment: 'live',
        context: 'laptop',
    });
    assert.ok(!text.includes(token), 'error text redacted');
    assert.ok(text.includes('_env: live · laptop_'));
    assert.ok(text.includes('cons_err'));
});
