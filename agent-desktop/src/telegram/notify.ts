/**
 * Consolidation-event notifications for Telegram (T08, SEC-COST-02).
 *
 * A consolidation run (T05 `runConsolidationJob`) ends with a
 * `ConsolidationJobResult` (counts: processed/graduated/superseded/
 * rejected/decayed/hot_demoted/paused) plus the per-model judge spend
 * from `CostTracker.summary()`. `buildConsolidationNotification`
 * formats the owner-facing message:
 *
 * - graduation/decay/supersede/rejection counts (the events the owner
 *   should know about — spec §8/§10),
 * - the per-model spend report with monthly caps and no keys
 *   (SEC-COST-02, ADR-010),
 * - a stable footer documenting the sandbox/live environment
 *   (acceptance criterion 2: the log must state the environment).
 *
 * The message contains NO memory content and NO secrets (SEC-KEY-01,
 * SEC-LOG-01): counts and USD amounts only.
 */

import { redactSecrets } from '../redact.js';
import type { ConsolidationJobResult } from '../consolidation.js';
import type { CostMonthFile } from '../costs.js';

/** Environment tag for the message footer (acceptance criterion 2). */
export type TelegramEnvironment = 'sandbox' | 'live';

/** Options for `buildConsolidationNotification`. */
export interface ConsolidationNotificationOptions {
    /** Environment the run happened in (footer; default 'sandbox'). */
    environment?: TelegramEnvironment;
    /** Human-readable sandbox/run context (default: run id). */
    context?: string;
}

/** Format a USD amount without floating-point noise. */
function usd(value: number): string {
    return `$${value.toFixed(4)}`;
}

/**
 * Build the consolidation notification message. Pure and deterministic
 * (no Date/random), so tests can pin the exact shape.
 */
export function buildConsolidationNotification(
    result: ConsolidationJobResult,
    spend: CostMonthFile,
    options: ConsolidationNotificationOptions = {},
): string {
    const environment = options.environment ?? 'sandbox';
    const status = result.paused
        ? 'paused (judge panel unavailable — SEC-COST-01)'
        : result.errors.length > 0
            ? 'error'
            : 'ok';
    const lines: string[] = [
        `🧠 Memory consolidation — ${result.runId}`,
        `• status: ${status}`,
        `• records processed: ${result.processed} (observations: ${result.observations})`,
        `• reflections: ${result.reflections} · candidates: ${result.candidates}`,
        `• graduated: ${result.graduated} · superseded: ${result.superseded}`,
        `• rejected: ${result.rejected} · decayed: ${result.decayed} · hot demoted: ${result.hot_demoted}`,
        `• duration: ${result.durationMs} ms`,
        '',
        `💰 Judge spend ${spend.month} (per model, caps — no keys, SEC-COST-02):`,
    ];
    for (const [name, p] of Object.entries(spend.providers)) {
        const state = p.disabled ? ' (capped/disabled)' : '';
        lines.push(`  • ${name}: ${usd(p.spentUsd)} / cap ${usd(p.capUsd)}${state}`);
    }
    const context = options.context?.trim();
    lines.push('', `_env: ${environment}${context ? ` · ${context}` : ''}_`);
    return redactSecrets(lines.join('\n'));
}

/** Build an error notification for a failed consolidation run (SEC-LOG-01). */
export function buildConsolidationErrorNotification(
    runId: string,
    error: unknown,
    options: { environment?: TelegramEnvironment; context?: string } = {},
): string {
    const message = error instanceof Error ? error.message : String(error);
    const environment = options.environment ?? 'sandbox';
    const context = options.context?.trim();
    const lines = [
        `⚠️ Memory consolidation failed — ${runId}`,
        `• ${redactSecrets(message.slice(0, 500))}`,
        '',
        `_env: ${environment}${context ? ` · ${context}` : ''}_`,
    ];
    return redactSecrets(lines.join('\n'));
}
