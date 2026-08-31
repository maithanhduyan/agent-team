/**
 * Telegram bridge CLI (T08).
 *
 *   npm run bridge:sandbox   # SANDBOX mode (default, CHẠY TRONG SANDBOX
 *                            # TRƯỚC — plan #22 T08): no network, no
 *                            # token; full cycle on a scratch memory dir:
 *                            # seed observations → consolidation (mock
 *                            # judge) → notification → inbound commands →
 *                            # replies. The outbound log is printed AND
 *                            # appended to the sandbox JSONL file.
 *   npm run bridge           # LIVE mode (owner laptop, Q3): requires
 *                            # TELEGRAM_SANDBOX=0 + TELEGRAM_BOT_TOKEN +
 *                            # TELEGRAM_CHAT_ID; long-polls the Bot API.
 *
 * Security: the bot token is read from the environment ONLY (SEC-KEY-01),
 * used solely to build per-request URLs, never logged/serialized
 * (SEC-KEY-02/03); every log line is redacted (SEC-LOG-01); memory
 * content in replies is rendered via the SEC-MEM-01 envelope
 * (commands.ts). The sandbox mode never touches the network.
 */

import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { loadMemoryConfig } from './config.js';
import { loadTelegramConfig, TelegramConfigError } from './telegram/config.js';
import { HttpTelegramTransport, SandboxTelegramTransport, type TelegramUpdate } from './telegram/transport.js';
import { TelegramBridge } from './telegram/bridge.js';
import { buildConsolidationNotification } from './telegram/notify.js';
import { redactSecrets } from './redact.js';

import { SessionsWriter } from './sessions-writer.js';
import { CoreWriter } from './core-writer.js';
import { runConsolidationJob, type ConsolidationJobResult } from './consolidation.js';
import { CostTracker } from './costs.js';
import { searchMemory } from './search-memory.js';
import { grepLogs } from './grep-logs.js';
import { loadHotFacts } from './hot-facts.js';
import type { LLMProvider, JudgeModelName } from './llm-provider.js';

/* ------------------------------------------------------------------ */
/* Sandbox mock judge (SANDBOX ONLY — deterministic, no network).      */
/* ------------------------------------------------------------------ */

/**
 * A deterministic mock LLM provider for the sandbox run: approves every
 * judge candidate and returns a fixed reflection lesson, recording spend
 * through the CostTracker exactly like a real provider (SEC-COST-01/02).
 * Used ONLY when the bridge runs in sandbox mode (never in live mode —
 * the live path uses the real registered providers / `DEEPSEEK_API_KEY`).
 */
class SandboxMockProvider implements LLMProvider {
    readonly name: JudgeModelName = 'deepseek';
    readonly modelId = 'deepseek-sandbox-mock';
    private readonly cost: CostTracker;

    constructor(cost: CostTracker) {
        this.cost = cost;
    }

    isEnabled(): boolean {
        return true;
    }

    async monthlyCostUsd(): Promise<number> {
        return this.cost.monthlySpend('deepseek');
    }

    async generate(req: { prompt: string }): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number }; costUsd: number }> {
        const prompt = req.prompt;
        let costUsd: number;
        let text: string;
        if (prompt.includes('# Candidate fact')) {
            // Judge prompt (judge.ts buildJudgePrompt) → approve verdict.
            text = JSON.stringify({
                verdict: 'approve',
                confidence: 0.92,
                reasons: ['sandbox mock: candidate grounded in supporting observations'],
                suggested_edit: null,
            });
            costUsd = 0.0002;
        } else {
            // Reflection prompt (reflect.ts buildReflectPrompt) → lesson.
            // The fix MUST token-overlap the supporting observations so the
            // deterministic verifier (spec §10.5.1) passes — mirrors a real
            // reflector compressing the vietnamese-language trajectory.
            text = JSON.stringify({
                context: 'owner prefers vietnamese for chat messages',
                error: 'messages in english were not preferred',
                fix: 'the owner prefers vietnamese for chat messages',
            });
            costUsd = 0.0001;
        }
        await this.cost.recordCost('deepseek', costUsd);
        return { text, usage: { inputTokens: 120, outputTokens: 30 }, costUsd };
    }
}

/* ------------------------------------------------------------------ */
/* Sandbox cycle                                                       */
/* ------------------------------------------------------------------ */

/** Seed a scratch memory dir with observations + an L3 hot fact. */
async function seedMemoryDir(memoryDir: string): Promise<void> {
    const writer = new SessionsWriter(memoryDir);
    const base = Date.parse('2026-09-01T08:00:00.000Z');
    const texts = [
        'the owner prefers vietnamese for chat messages',
        'the owner uses vietnamese for chat messages',
        'the owner writes chat messages in vietnamese',
    ];
    for (let i = 0; i < texts.length; i++) {
        const res = await writer.append({
            type: 'observation',
            provenance: 'user_stated',
            importance: 0.8,
            content: { text: texts[i], kind: 'preference' },
            source: { kind: 'user', ref: 'telegram:chat:12345', detail: 'sandbox seed' },
            meta: { tags: ['language', 'preference'], ts_pin: new Date(base + i * 86_400_000).toISOString() },
        });
        if (res.status !== 'written') {
            throw new Error(`sandbox seed failed: ${JSON.stringify(res)}`);
        }
    }
    // Hot fact in core.md (R-CORE-1: only consolidation may write L3, so
    // seed via the CoreWriter with a synthetic consolidation context).
    const cons = { runId: `cons_${randomUUID()}` };
    const core = new CoreWriter(memoryDir);
    await core.appendFact(cons, {
        statement: 'The owner communicates with the agent in Vietnamese.',
        provenance: 'user_stated',
        importance: 0.95,
        hot: true,
        source: 'telegram:chat:12345',
        supporting_observations: ['evt_seed_1', 'evt_seed_2', 'evt_seed_3'],
        observation_count: 3,
        last_observed: new Date(base + 3 * 86_400_000).toISOString(),
        title: 'Owner communicates in Vietnamese',
    });
}

/** Inbound sandbox updates (Bot API shapes) exercised by the sandbox run. */
function sandboxInboundUpdates(): TelegramUpdate[] {
    const chat = { id: '12345', type: 'private' as const };
    const from = { id: '12345', username: 'owner', first_name: 'Owner' };
    const mk = (id: number, text: string): TelegramUpdate => ({
        update_id: id,
        message: { message_id: id, chat, from, text, date: 1_752_540_000 + id },
    });
    return [
        mk(1, '/memory search vietnamese'),
        mk(2, '/memory grep vietnamese'),
        mk(3, '/memory hot'),
        mk(4, '/memory spend'),
        mk(5, '/memory help'),
        mk(6, '/memory unknown-command'),
    ];
}

/** Run the full sandbox cycle and print the transcript (acceptance
 * criterion 2 — the log clearly states the SANDBOX environment). */
async function runSandboxCycle(): Promise<void> {
    const stamp = new Date().toISOString();
    process.stdout.write('='.repeat(72) + '\n');
    process.stdout.write(`🧪 TELEGRAM BRIDGE — SANDBOX RUN (plan #22 T08: CHẠY TRONG SANDBOX TRƯỚC)\n`);
    process.stdout.write(`   started: ${stamp} · environment: SANDBOX (no network, no token)\n`);
    process.stdout.write('='.repeat(72) + '\n\n');

    const memCfg = loadMemoryConfig();
    const tgCfg = loadTelegramConfig(process.env, memCfg.memoryDir);
    if (!tgCfg.sandbox) {
        throw new Error('refusing sandbox cycle in live config (TELEGRAM_SANDBOX must be 0 only for live)');
    }

    // Scratch memory dir (sandbox data never touches the real memory dir).
    const scratch = await mkdtemp(path.join(tmpdir(), 'agent-desktop-telegram-sandbox-'));
    const memoryDir = path.join(scratch, 'memory');
    await mkdir(memoryDir, { recursive: true, mode: 0o700 });
    const sandboxFile = path.join(scratch, 'telegram-sandbox.jsonl');
    process.stdout.write(`[SANDBOX] scratch memory dir: ${memoryDir}\n`);
    process.stdout.write(`[SANDBOX] sandbox transport file: ${sandboxFile}\n`);

    // 1. Seed memory.
    process.stdout.write('\n[SANDBOX] seeding scratch memory (3 Vietnamese-language observations + 1 hot fact)...\n');
    await seedMemoryDir(memoryDir);

    // 2. Consolidation with a mock judge (sandbox only) + notification.
    process.stdout.write('\n[SANDBOX] running consolidation job (mock judge, deterministic)...\n');
    const cost = new CostTracker(memoryDir);
    await cost.load();
    const providers: Record<string, LLMProvider> = { deepseek: new SandboxMockProvider(cost) };
    const result = await runConsolidationJob({
        memoryDir,
        cfg: { ...memCfg, JUDGE_PANEL_MODELS: 'deepseek' },
        providers,
    });
    process.stdout.write(`[SANDBOX] consolidation ${result.runId}: graduated=${result.graduated} ` +
        `superseded=${result.superseded} rejected=${result.rejected} decayed=${result.decayed}\n`);
    const spend = cost.summary();
    const notification = buildConsolidationNotification(result, spend, {
        environment: 'sandbox',
        context: 'sandbox cycle (mock judge)',
    });
    process.stdout.write('\n[SANDBOX] consolidation notification:\n');
    process.stdout.write('---\n' + notification + '\n---\n');

    // 3. Bridge over the sandbox transport: notifications + commands.
    const transport = new SandboxTelegramTransport({ file: sandboxFile });
    const memory = {
        search: async (query: string) => {
            const out = await searchMemory(memoryDir, { query, top_k: 5 }, {
                weights: memCfg.retrievalWeights,
                halfLifeDays: memCfg.recencyHalfLifeDays,
            });
            return { results: out.results, meta: out.meta };
        },
        grep: async (pattern: string) => {
            const out = await grepLogs(memoryDir, { pattern, files: 'memory', context_lines: 1, limit: 20 }, {
                runsDir: memCfg.runsDir,
            });
            return { matches: out.matches, meta: out.meta };
        },
        hotFacts: async () => loadHotFacts(memoryDir, { minImportance: memCfg.hotImportance, max: memCfg.hotMax, decayDays: memCfg.decayDays }),
        spend: () => cost.summary(),
    };
    const bridge = new TelegramBridge({
        config: tgCfg,
        transport,
        memory,
        costTracker: cost,
        environment: 'sandbox',
        context: 'sandbox cycle (mock judge)',
        log: {
            warn: (m: string) => process.stdout.write(`[SANDBOX] ${redactSecrets(m)}\n`),
            info: (m: string) => process.stdout.write(`[SANDBOX] ${redactSecrets(m)}\n`),
            debug: () => {},
            error: (m: string) => process.stdout.write(`[SANDBOX] ${redactSecrets(m)}\n`),
        },
    });

    // Send the consolidation notification through the bridge (chat ids
    // from TELEGRAM_CHAT_ID; sandbox default falls back to a marker).
    const notifyChats = tgCfg.notifyChatIds.length > 0 ? tgCfg.notifyChatIds : ['sandbox-chat'];
    for (const chatId of notifyChats) {
        await transport.sendMessage(chatId, notification);
    }
    process.stdout.write(`\n[SANDBOX] notification queued to chat(s): ${notifyChats.join(', ')}\n`);

    // 4. Inbound commands → replies.
    process.stdout.write('\n[SANDBOX] feeding inbound commands and polling once...\n');
    await writeFile(sandboxFile, sandboxInboundUpdates().map((u) => JSON.stringify(u)).join('\n') + '\n', {
        encoding: 'utf8',
        mode: 0o600,
    });
    const handled = await bridge.pollOnce();
    process.stdout.write(`[SANDBOX] handled ${handled} command(s)\n`);

    // 5. Evidence: print the full outbound log from the sandbox file.
    process.stdout.write('\n' + '='.repeat(72) + '\n');
    process.stdout.write('📄 SANDBOX OUTBOUND LOG (JSONL — evidence for acceptance criterion 2)\n');
    process.stdout.write('='.repeat(72) + '\n');
    const raw = await readFile(sandboxFile, 'utf8');
    process.stdout.write(raw);
    process.stdout.write('='.repeat(72) + '\n');
    process.stdout.write(`✅ SANDBOX RUN COMPLETE — environment: SANDBOX · no network · no token · ` +
        `memory dir: ${memoryDir}\n`);
    process.stdout.write(`   To deploy LIVE on the laptop (Q3): set TELEGRAM_SANDBOX=0 + ` +
        `TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, then "npm run bridge".\n\n`);

    await rm(scratch, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ */
/* Live loop (owner laptop, Q3)                                        */
/* ------------------------------------------------------------------ */

async function runLiveLoop(): Promise<void> {
    const memCfg = loadMemoryConfig();
    const tgCfg = loadTelegramConfig(process.env, memCfg.memoryDir);
    if (tgCfg.sandbox) {
        throw new TelegramConfigError(
            'live mode requires TELEGRAM_SANDBOX=0 AND TELEGRAM_BOT_TOKEN (sandbox-first, plan #22 T08)',
        );
    }
    if (tgCfg.notifyChatIds.length === 0) {
        throw new TelegramConfigError('live mode requires TELEGRAM_CHAT_ID');
    }
    const cost = new CostTracker(memCfg.memoryDir);
    await cost.load();
    const transport = new HttpTelegramTransport({
        botToken: tgCfg.botToken,
        apiBase: tgCfg.apiBase,
        pollIntervalMs: tgCfg.pollIntervalMs,
        timeoutS: tgCfg.timeoutS,
    });
    const bridge = new TelegramBridge({
        config: tgCfg,
        transport,
        memory: {
            search: async (query: string) => {
                const out = await searchMemory(memCfg.memoryDir, { query, top_k: 5 }, {
                    weights: memCfg.retrievalWeights,
                    halfLifeDays: memCfg.recencyHalfLifeDays,
                });
                return { results: out.results, meta: out.meta };
            },
            grep: async (pattern: string) => {
                const out = await grepLogs(memCfg.memoryDir, { pattern, files: 'memory', context_lines: 1, limit: 20 }, {
                    runsDir: memCfg.runsDir,
                });
                return { matches: out.matches, meta: out.meta };
            },
            hotFacts: async () => loadHotFacts(memCfg.memoryDir, { minImportance: memCfg.hotImportance, max: memCfg.hotMax, decayDays: memCfg.decayDays }),
            spend: () => cost.summary(),
        },
        costTracker: cost,
        environment: 'live',
        context: 'owner laptop (Q3)',
    });
    process.stdout.write(
        `telegram bridge LIVE — polling ${tgCfg.apiBase} every ${tgCfg.pollIntervalMs} ms ` +
        `(notify chats: ${tgCfg.notifyChatIds.join(',')})\n`,
    );
    await bridge.start();
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

const LIVE_FLAG = process.argv.includes('--live') || process.argv.includes('-L');
const SANDBOX_FLAG = process.argv.includes('--sandbox');

async function main(): Promise<void> {
    if (LIVE_FLAG && !SANDBOX_FLAG) {
        await runLiveLoop();
        return;
    }
    await runSandboxCycle();
}

main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`telegram bridge failed: ${redactSecrets(msg)}\n`);
    process.exitCode = 1;
});
