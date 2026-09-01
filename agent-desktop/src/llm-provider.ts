/**
 * Multi-model judge/reflection provider abstraction (spec §9.2, Q5 —
 * ADR-008/ADR-010, SEC-KEY-01…03).
 *
 * All judge/reflection LLM calls go through this uniform interface.
 * Each provider is an **optional module**: a provider whose API key is
 * missing or that is disabled by config is simply not registered /
 * skipped, and the pipeline runs with the remaining ones (SEC-KEY-03 —
 * missing keys disable a model, they never fail the pipeline).
 *
 * Security envelope (ADR-010):
 * - SEC-KEY-01/02: keys are read from the environment at construction
 *   and go ONLY into the HTTP `Authorization`/`x-goog-api-key` header —
 *   never into prompts, verdicts, L2 records, logs or artifacts, and
 *   never serialized by this module.
 * - SEC-LOG-01: providers log only model ids and status codes, never
 *   request content; the judge/reflection path redacts further
 *   (`redact.ts`).
 *
 * Default panel is `deepseek` only (its key is available); `gpt-4` and
 * `gemini-2.5-pro` activate the moment `OPENAI_API_KEY` / `GEMINI_API_KEY`
 * are provided by the owner (Q5 — both provided on 2026-09-01, Redmine
 * #50; verified: OpenAI 126 models, Gemini 50 models — real model id
 * `gemini-2.5-pro`, there is no "gemini-3" on the API).
 */

import { parseJudgePanelModels, type MemoryConfig } from './config.js';
import { redactSecrets } from './redact.js';
import type { CostTracker } from './costs.js';

/** Registry keys of the judge panel (§9.2 table). */
export type JudgeModelName = 'deepseek' | 'gpt-4' | 'gemini-2.5-pro';

/** The uniform provider contract (spec §9.2). */
export interface LLMProvider {
    /** Registry key (one of the panel names). */
    readonly name: JudgeModelName;
    /** Provider model id (e.g. `deepseek-chat`). */
    readonly modelId: string;
    /**
     * Generate one completion. `text` MUST parse as the verdict JSON
     * (§9.3) when used by the judge; `usage`/`costUsd` feed the cost
     * tracker (§9.5). Throws on transport/API error — the caller counts
     * it as an error for that model (R-JUDGE-4).
     */
    generate(req: {
        prompt: string;
        temperature?: number;
        maxTokens?: number;
    }): Promise<{
        text: string;
        usage: { inputTokens: number; outputTokens: number };
        costUsd: number;
    }>;
    /** False when the API key is missing or the model is disabled by config. */
    isEnabled(): boolean;
    /** Accumulated spend this calendar month (spec §9.5). */
    monthlyCostUsd(): Promise<number>;
}

/** Per-model price table (USD per 1M tokens) — §9.5 cost accounting. */
export interface PriceTable {
    inputPerM: number;
    outputPerM: number;
}

/** Shipped price tables. Values are documented constants (ADR-013);
 * gemini-2.5-pro = $1.25 in / $10.00 out per 1M tokens (≤200k context,
 * Google AI pricing — corrected from the T05 "gemini-3" placeholder). */
export const PRICE_TABLE: Record<JudgeModelName, PriceTable> = {
    deepseek: { inputPerM: 0.27, outputPerM: 1.1 },
    'gpt-4': { inputPerM: 30, outputPerM: 60 },
    'gemini-2.5-pro': { inputPerM: 1.25, outputPerM: 10 },
};

/** Compute the USD cost of a completion from the price table. */
export function completionCostUsd(
    name: JudgeModelName,
    usage: { inputTokens: number; outputTokens: number },
): number {
    const p = PRICE_TABLE[name];
    return (usage.inputTokens * p.inputPerM + usage.outputTokens * p.outputPerM) / 1_000_000;
}

/** Common provider options. */
export interface ProviderOptions {
    /** API key (default: read from the matching `*_API_KEY` env var). */
    apiKey?: string;
    /** Environment to read keys/disable flags from (default `process.env`). */
    env?: NodeJS.ProcessEnv;
    /** Cost tracker for `monthlyCostUsd()` (optional; 0 when absent). */
    costTracker?: CostTracker;
    /** Fetch implementation (injectable for tests; default global fetch). */
    fetchImpl?: typeof fetch;
    /** Logger (default console). */
    log?: Pick<Console, 'warn' | 'info' | 'debug'>;
}

/** Extract a chat-completion text from an OpenAI-compatible response. */
function parseOpenAiCompatibleCompletion(data: unknown): string {
    if (typeof data !== 'object' || data === null) {
        throw new Error('provider response is not a JSON object');
    }
    const choices = (data as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) {
        throw new Error('provider response has no choices');
    }
    const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
    if (typeof content !== 'string') {
        throw new Error('provider response has no message content');
    }
    return content;
}

/** Extract usage token counts from an OpenAI-compatible response. */
function parseOpenAiUsage(data: unknown): { inputTokens: number; outputTokens: number } {
    const usage = (data as { usage?: unknown }).usage;
    if (typeof usage !== 'object' || usage === null) {
        return { inputTokens: 0, outputTokens: 0 };
    }
    return {
        inputTokens: Number((usage as { prompt_tokens?: number }).prompt_tokens ?? 0),
        outputTokens: Number((usage as { completion_tokens?: number }).completion_tokens ?? 0),
    };
}

/** Shared chat-completions call (DeepSeek + gpt-4, OpenAI-compatible API). */
async function chatCompletion(
    opts: {
        url: string;
        apiKey: string;
        modelId: string;
        req: { prompt: string; temperature?: number; maxTokens?: number };
        fetchImpl: typeof fetch;
    },
): Promise<{ data: unknown; status: number }> {
    const res = await opts.fetchImpl(opts.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
            model: opts.modelId,
            messages: [{ role: 'user', content: opts.req.prompt }],
            temperature: opts.req.temperature ?? 0,
            max_tokens: opts.req.maxTokens ?? 1024,
        }),
    });
    const text = await res.text();
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(`provider HTTP ${res.status}: non-JSON response`);
    }
    if (!res.ok) {
        throw new Error(`provider HTTP ${res.status}: ${redactSecrets(text).slice(0, 300)}`);
    }
    return { data, status: res.status };
}

/**
 * DeepSeek provider (default panel, key available). Uses the
 * OpenAI-compatible `https://api.deepseek.com/chat/completions` endpoint.
 */
export class DeepSeekProvider implements LLMProvider {
    readonly name = 'deepseek' as const;
    readonly modelId: string;
    private readonly apiKey: string | undefined;
    private readonly env: NodeJS.ProcessEnv;
    private readonly costTracker: CostTracker | undefined;
    private readonly fetchImpl: typeof fetch;
    private readonly log: Pick<Console, 'warn' | 'info' | 'debug'>;

    constructor(modelId = 'deepseek-chat', opts: ProviderOptions = {}) {
        this.modelId = modelId;
        this.env = opts.env ?? process.env;
        this.apiKey = opts.apiKey ?? this.env.DEEPSEEK_API_KEY;
        this.costTracker = opts.costTracker;
        this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
        this.log = opts.log ?? console;
    }

    isEnabled(): boolean {
        return typeof this.apiKey === 'string' && this.apiKey.trim() !== '';
    }

    async monthlyCostUsd(): Promise<number> {
        return this.costTracker?.monthlySpend(this.name) ?? 0;
    }

    async generate(req: {
        prompt: string;
        temperature?: number;
        maxTokens?: number;
    }): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number }; costUsd: number }> {
        if (!this.isEnabled()) {
            throw new Error('deepseek provider is not enabled (DEEPSEEK_API_KEY missing)');
        }
        const { data, status } = await chatCompletion({
            url: 'https://api.deepseek.com/chat/completions',
            apiKey: this.apiKey!,
            modelId: this.modelId,
            req,
            fetchImpl: this.fetchImpl,
        });
        const text = parseOpenAiCompatibleCompletion(data);
        const usage = parseOpenAiUsage(data);
        this.log.debug?.(`[judge] deepseek ${this.modelId} HTTP ${status} tokens=${usage.inputTokens}+${usage.outputTokens}`);
        return { text, usage, costUsd: completionCostUsd(this.name, usage) };
    }
}

/**
 * gpt-4 provider (disabled until `OPENAI_API_KEY` is provided — Q5).
 * OpenAI-compatible chat completions endpoint.
 */
export class Gpt4Provider implements LLMProvider {
    readonly name = 'gpt-4' as const;
    readonly modelId: string;
    private readonly apiKey: string | undefined;
    private readonly env: NodeJS.ProcessEnv;
    private readonly costTracker: CostTracker | undefined;
    private readonly fetchImpl: typeof fetch;
    private readonly log: Pick<Console, 'warn' | 'info' | 'debug'>;

    constructor(modelId = 'gpt-4', opts: ProviderOptions = {}) {
        this.modelId = modelId;
        this.env = opts.env ?? process.env;
        this.apiKey = opts.apiKey ?? this.env.OPENAI_API_KEY;
        this.costTracker = opts.costTracker;
        this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
        this.log = opts.log ?? console;
    }

    isEnabled(): boolean {
        return typeof this.apiKey === 'string' && this.apiKey.trim() !== '';
    }

    async monthlyCostUsd(): Promise<number> {
        return this.costTracker?.monthlySpend(this.name) ?? 0;
    }

    async generate(req: {
        prompt: string;
        temperature?: number;
        maxTokens?: number;
    }): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number }; costUsd: number }> {
        if (!this.isEnabled()) {
            throw new Error('gpt-4 provider is not enabled (OPENAI_API_KEY missing)');
        }
        const { data, status } = await chatCompletion({
            url: 'https://api.openai.com/v1/chat/completions',
            apiKey: this.apiKey!,
            modelId: this.modelId,
            req,
            fetchImpl: this.fetchImpl,
        });
        const text = parseOpenAiCompatibleCompletion(data);
        const usage = parseOpenAiUsage(data);
        this.log.debug?.(`[judge] gpt-4 ${this.modelId} HTTP ${status} tokens=${usage.inputTokens}+${usage.outputTokens}`);
        return { text, usage, costUsd: completionCostUsd(this.name, usage) };
    }
}

/** Extract a text from a Google Generative Language API response. */
function parseGeminiCompletion(data: unknown): { text: string; usage: { inputTokens: number; outputTokens: number } } {
    if (typeof data !== 'object' || data === null) {
        throw new Error('provider response is not a JSON object');
    }
    const candidates = (data as { candidates?: unknown }).candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) {
        throw new Error('provider response has no candidates');
    }
    const parts = (candidates[0] as { content?: { parts?: unknown } }).content?.parts;
    if (!Array.isArray(parts)) {
        throw new Error('provider response has no content parts');
    }
    const text = parts
        .map((p) => (typeof p === 'object' && p !== null ? (p as { text?: unknown }).text : undefined))
        .filter((t): t is string => typeof t === 'string')
        .join('');
    if (text === '') {
        throw new Error('provider response has no text');
    }
    const usageMeta = (data as { usageMetadata?: unknown }).usageMetadata;
    const usage = {
        inputTokens: Number((usageMeta as { promptTokenCount?: number } | undefined)?.promptTokenCount ?? 0),
        outputTokens: Number((usageMeta as { candidatesTokenCount?: number } | undefined)?.candidatesTokenCount ?? 0),
    };
    return { text, usage };
}

/**
 * gemini-2.5-pro provider (disabled until `GEMINI_API_KEY` is provided —
 * Q5; key provided 2026-09-01). The key goes in the `x-goog-api-key`
 * header (never in the URL, so it can never leak into a logged URL —
 * SEC-KEY-01). Model id is the REAL API id `gemini-2.5-pro` (there is
 * no "gemini-3" on the Gemini API).
 */
export class Gemini25ProProvider implements LLMProvider {
    readonly name = 'gemini-2.5-pro' as const;
    readonly modelId: string;
    private readonly apiKey: string | undefined;
    private readonly env: NodeJS.ProcessEnv;
    private readonly costTracker: CostTracker | undefined;
    private readonly fetchImpl: typeof fetch;
    private readonly log: Pick<Console, 'warn' | 'info' | 'debug'>;

    constructor(modelId = 'gemini-2.5-pro', opts: ProviderOptions = {}) {
        this.modelId = modelId;
        this.env = opts.env ?? process.env;
        this.apiKey = opts.apiKey ?? this.env.GEMINI_API_KEY;
        this.costTracker = opts.costTracker;
        this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
        this.log = opts.log ?? console;
    }

    isEnabled(): boolean {
        return typeof this.apiKey === 'string' && this.apiKey.trim() !== '';
    }

    async monthlyCostUsd(): Promise<number> {
        return this.costTracker?.monthlySpend(this.name) ?? 0;
    }

    async generate(req: {
        prompt: string;
        temperature?: number;
        maxTokens?: number;
    }): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number }; costUsd: number }> {
        if (!this.isEnabled()) {
            throw new Error('gemini-2.5-pro provider is not enabled (GEMINI_API_KEY missing)');
        }
        const res = await this.fetchImpl(
            `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:generateContent`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': this.apiKey!,
                },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
                    generationConfig: {
                        temperature: req.temperature ?? 0,
                        maxOutputTokens: req.maxTokens ?? 1024,
                    },
                }),
            },
        );
        const text = await res.text();
        let data: unknown;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error(`provider HTTP ${res.status}: non-JSON response`);
        }
        if (!res.ok) {
            throw new Error(`provider HTTP ${res.status}: ${redactSecrets(text).slice(0, 300)}`);
        }
        const parsed = parseGeminiCompletion(data);
        this.log.debug?.(`[judge] gemini-2.5-pro ${this.modelId} HTTP ${res.status} tokens=${parsed.usage.inputTokens}+${parsed.usage.outputTokens}`);
        return { text: parsed.text, usage: parsed.usage, costUsd: completionCostUsd(this.name, parsed.usage) };
    }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const registry = new Map<JudgeModelName, LLMProvider>();

/** Register a provider (optional module — §9.2). */
export function registerProvider(provider: LLMProvider): void {
    registry.set(provider.name, provider);
}

/** Get a registered provider by name. */
export function getProvider(name: string): LLMProvider | undefined {
    return registry.get(name as JudgeModelName);
}

/** List registered providers (registry insertion order). */
export function listProviders(): LLMProvider[] {
    return [...registry.values()];
}

/** Remove all providers (tests). */
export function clearProviders(): void {
    registry.clear();
}

/** Build the default provider set (all three optional modules). */
export function defaultProviders(opts: ProviderOptions = {}): LLMProvider[] {
    const tracker = opts.costTracker;
    return [
        new DeepSeekProvider('deepseek-chat', { ...opts, costTracker: tracker }),
        new Gpt4Provider('gpt-4', { ...opts, costTracker: tracker }),
        new Gemini25ProProvider('gemini-2.5-pro', { ...opts, costTracker: tracker }),
    ];
}

/**
 * Build the enabled judge panel from `JUDGE_PANEL_MODELS` (priority
 * order, spec §9.4). Providers missing from the registry or disabled
 * (no key / config-disabled) are SKIPPED, not failures (SEC-KEY-03,
 * R-JUDGE-4). `extraProviders` (e.g. mocks) override the registry for
 * their names.
 */
export function buildPanelFromConfig(
    cfg: Pick<MemoryConfig, 'judgePanelModels'> | { judgePanelModels?: string[] },
    opts: { providers?: Record<string, LLMProvider>; env?: NodeJS.ProcessEnv } = {},
): LLMProvider[] {
    const panelNames = parseJudgePanelModels(
        opts.env?.JUDGE_PANEL_MODELS,
        cfg.judgePanelModels ?? ['deepseek'],
    );
    const panel: LLMProvider[] = [];
    for (const name of panelNames) {
        const provider = opts.providers?.[name] ?? getProvider(name);
        if (provider && provider.isEnabled()) {
            panel.push(provider);
        }
    }
    return panel;
}
