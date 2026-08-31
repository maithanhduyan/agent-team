/**
 * Telegram bridge — memory notifications + chat commands (T08).
 *
 * Responsibilities (plan #22 T08, spec §7/§8/§9.5):
 * 1. **Consolidation events → Telegram notification**: after a T05
 *    consolidation run, notify the owner with graduation/decay/supersede
 *    counts + the per-model spend report (SEC-COST-02, no keys) —
 *    `notifyConsolidation()` / `runConsolidationAndNotify()`.
 * 2. **Chat commands → memory queries**: `/memory search|grep|hot|
 *    spend|help` handled via `MemoryCommandDeps` and rendered through
 *    the SEC-MEM-01 envelope (commands.ts).
 *
 * Sandbox-first (plan #22 T08, acceptance criterion 2): the bridge runs
 * against the configured `TelegramTransport` — `SandboxTelegramTransport`
 * (JSONL file, no network) in CI/sandbox, `HttpTelegramTransport` only
 * on the owner's laptop (Q3). Every log line is redacted (SEC-LOG-01)
 * and the environment is recorded in notifications.
 */

import { redactSecrets } from '../redact.js';
import type { ConsolidationJobResult } from '../consolidation.js';
import type { CostTracker, CostMonthFile } from '../costs.js';
import type { TelegramConfig } from './config.js';
import type { TelegramTransport, TelegramUpdate } from './transport.js';
import {
    executeMemoryCommand,
    parseMemoryCommand,
    type MemoryCommandDeps,
} from './commands.js';
import {
    buildConsolidationErrorNotification,
    buildConsolidationNotification,
    type TelegramEnvironment,
} from './notify.js';

/** Bridge options. */
export interface TelegramBridgeOptions {
    config: TelegramConfig;
    transport: TelegramTransport;
    /** Memory command handlers (T04 exports; see `MemoryCommandDeps`). */
    memory: MemoryCommandDeps;
    /** Cost tracker for the spend report (SEC-COST-02). */
    costTracker: CostTracker;
    /** Environment tag for notification footers (default 'sandbox'). */
    environment?: TelegramEnvironment;
    /** Human-readable context appended to footers (e.g. run context). */
    context?: string;
    /** Logger (default console); every line redacted on write. */
    log?: Pick<Console, 'warn' | 'info' | 'debug' | 'error'>;
}

/** A handled chat command outcome (testable). */
export interface CommandOutcome {
    command: string;
    chatId: string;
    reply: string;
    /** True when the chat was not in the allowlist (ignored). */
    ignored: boolean;
}

/**
 * The Telegram memory bridge. Not thread-safe: callers run either
 * `pollOnce()`-based cycles or `start()` (single loop).
 */
export class TelegramBridge {
    readonly config: TelegramConfig;
    readonly transport: TelegramTransport;
    private readonly memory: MemoryCommandDeps;
    private readonly costTracker: CostTracker;
    private readonly environment: TelegramEnvironment;
    private readonly context: string;
    private readonly log: Pick<Console, 'warn' | 'info' | 'debug' | 'error'>;
    private offset = 0;
    private stopped = false;

    constructor(options: TelegramBridgeOptions) {
        this.config = options.config;
        this.transport = options.transport;
        this.memory = options.memory;
        this.costTracker = options.costTracker;
        this.environment = options.environment ?? 'sandbox';
        this.context = options.context ?? '';
        this.log = options.log ?? console;
    }

    /** Redacted logger (SEC-LOG-01). */
    private info(line: string): void {
        this.log.info?.(redactSecrets(line));
    }
    private warn(line: string): void {
        this.log.warn?.(redactSecrets(line));
    }

    /** Whether a chat id may issue commands (allowlist; empty = all). */
    isAllowedChat(chatId: string): boolean {
        if (this.config.allowedChatIds.length === 0) {
            return true;
        }
        return this.config.allowedChatIds.includes(chatId);
    }

    /**
     * Handle ONE inbound update. Returns the outcome (reply or ignored).
     * Only `message.text` updates are handled; anything else is ignored.
     */
    async handleUpdate(update: TelegramUpdate): Promise<CommandOutcome | null> {
        const message = update.message;
        if (!message) {
            return null;
        }
        const text = message.text;
        if (typeof text !== 'string' || text.trim() === '') {
            return null;
        }
        const chatId = String(message.chat.id);
        if (!this.isAllowedChat(chatId)) {
            this.warn(`[telegram] ignoring command from non-allowlisted chat ${chatId} (SEC)`);
            return { command: text.slice(0, 80), chatId, reply: '', ignored: true };
        }
        const command = parseMemoryCommand(text);
        const reply = await executeMemoryCommand(command, {
            ...this.memory,
            maxMessageLength: this.config.maxMessageLength,
        });
        await this.transport.sendMessage(chatId, reply);
        this.info(`[telegram] chat ${chatId} → /memory ${command.name} (${reply.length} chars)`);
        return { command: command.name, chatId, reply, ignored: false };
    }

    /**
     * Poll the transport for pending updates and handle each one. Returns
     * the number of handled updates. Advances the internal offset so each
     * update is handled exactly once.
     */
    async pollOnce(): Promise<number> {
        const updates = await this.transport.getUpdates(this.offset);
        let handled = 0;
        for (const update of updates) {
            if (update.update_id > this.offset) {
                this.offset = update.update_id;
            }
            const outcome = await this.handleUpdate(update);
            if (outcome && !outcome.ignored) {
                handled += 1;
            }
        }
        return handled;
    }

    /** Current spend summary (SEC-COST-02). */
    async spendSummary(): Promise<CostMonthFile> {
        await this.costTracker.load();
        return this.costTracker.summary();
    }

    /**
     * Send the consolidation notification for a finished run to all
     * notify chat ids (SEC-COST-02: counts + spend, no keys).
     */
    async notifyConsolidation(result: ConsolidationJobResult): Promise<void> {
        const spend = await this.spendSummary();
        const text = buildConsolidationNotification(result, spend, {
            environment: this.environment,
            context: this.context,
        });
        for (const chatId of this.config.notifyChatIds) {
            await this.transport.sendMessage(chatId, text);
        }
        this.info(`[telegram] consolidation notification sent (${result.runId}, env=${this.environment})`);
    }

    /**
     * Send a consolidation FAILURE notification (SEC-LOG-01 redacted).
     */
    async notifyConsolidationError(runId: string, error: unknown): Promise<void> {
        const text = buildConsolidationErrorNotification(runId, error, {
            environment: this.environment,
            context: this.context,
        });
        for (const chatId of this.config.notifyChatIds) {
            await this.transport.sendMessage(chatId, text);
        }
        this.warn(`[telegram] consolidation failure notification sent (${runId})`);
    }

    /**
     * Run one consolidation cycle: run the job (via `runner`), then
     * notify. Returns the job result. On job failure the error is
     * caught, notified (redacted) and rethrown so callers can schedule
     * retries.
     */
    async runConsolidationAndNotify(
        runner: () => Promise<ConsolidationJobResult>,
    ): Promise<ConsolidationJobResult> {
        try {
            const result = await runner();
            await this.notifyConsolidation(result);
            return result;
        } catch (err) {
            await this.notifyConsolidationError('consolidation-cycle', err);
            throw err;
        }
    }

    /**
     * Long-poll loop: poll updates until `stop()` is called. Used by the
     * live CLI (owner laptop, Q3); sandbox CI uses `pollOnce()` on a
     * seeded file instead.
     */
    async start(): Promise<void> {
        this.stopped = false;
        this.info(`[telegram] bridge started (env=${this.environment}, transport=${this.transport.mode})`);
        while (!this.stopped) {
            try {
                await this.pollOnce();
            } catch (err) {
                this.warn(`[telegram] poll error: ${err instanceof Error ? err.message : String(err)}`);
            }
            await sleep(this.config.pollIntervalMs);
        }
        this.info('[telegram] bridge stopped');
    }

    stop(): void {
        this.stopped = true;
    }
}

/** Small sleep helper. */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
