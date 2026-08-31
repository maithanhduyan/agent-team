/**
 * Per-model monthly cost tracking for the judge panel (spec §9.5,
 * SEC-COST-01/02 — ADR-010).
 *
 * Cost is accumulated per model per calendar month and persisted in
 * `memory/costs-YYYYMM.json` (OUTSIDE memory semantic content — it
 * holds no observations, only model names + USD amounts, and never any
 * API key — SEC-KEY-01/SEC-COST-01).
 *
 * - When a model reaches its monthly cap (`JUDGE_CAP_*_USD`) it is
 *   auto-disabled for the rest of the month (logged).
 * - When ALL enabled models are capped, consolidation/evolution pauses
 *   safely — no unjudged write, no cap override (SEC-COST-01).
 * - Spend is reported to the owner per model (T08) without keys
 *   (SEC-COST-02).
 *
 * File shape (`memory/costs-YYYYMM.json`):
 * ```jsonc
 * { "month": "2026-09",
 *   "providers": { "deepseek": { "spentUsd": 3.42, "capUsd": 15, "disabled": false } } }
 * ```
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { JudgeModelName } from './llm-provider.js';

/** Per-provider persisted cost state. */
export interface ProviderCostState {
    spentUsd: number;
    capUsd: number;
    /** Auto-disabled for this month (cap reached, SEC-COST-01). */
    disabled: boolean;
}

/** Shape of `memory/costs-YYYYMM.json`. */
export interface CostMonthFile {
    month: string;
    providers: Record<string, ProviderCostState>;
}

export interface CostTrackerOptions {
    /** Calendar month key to use (default: current UTC month). */
    month?: string;
    /** Clock for the month key; injectable for tests. */
    now?: () => Date;
    /** Fallback caps when a provider has no recorded capUsd yet. */
    caps?: Partial<Record<JudgeModelName, number>>;
    /** Logger for auto-disable/warn messages. Default: console. */
    log?: Pick<Console, 'warn' | 'info'>;
}

/** `YYYY-MM` (UTC) month key of a date. */
export function monthKeyOf(date: Date): string {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
}

/** Default caps (spec §9.5 table). */
export const DEFAULT_JUDGE_CAPS: Record<JudgeModelName, number> = {
    deepseek: 15,
    'gpt-4': 10,
    'gemini-3': 10,
};

export class CostTracker {
    readonly dir: string;
    private readonly opts: Required<Pick<CostTrackerOptions, 'now'>> & CostTrackerOptions;
    private state: CostMonthFile | null = null;
    private loadedForMonth: string | null = null;

    constructor(memoryDir: string, opts: CostTrackerOptions = {}) {
        this.dir = memoryDir;
        this.opts = {
            now: opts.now ?? (() => new Date()),
            ...opts,
        };
    }

    /** Current month key (UTC). */
    currentMonth(): string {
        return this.opts.month ?? monthKeyOf(this.opts.now());
    }

    /** Path of the current month's cost file. */
    filePath(): string {
        return path.join(this.dir, `costs-${this.currentMonth()}.json`);
    }

    /** Load the month's cost file (idempotent; missing file → zero state). */
    async load(): Promise<void> {
        const month = this.currentMonth();
        if (this.loadedForMonth === month) {
            return;
        }
        this.state = null;
        this.loadedForMonth = month;
        const file = this.filePath();
        let raw: string;
        try {
            raw = await readFile(file, 'utf8');
        } catch {
            this.state = { month, providers: {} };
            return;
        }
        try {
            const parsed = JSON.parse(raw) as CostMonthFile;
            this.state = parsed.month === month ? parsed : { month, providers: {} };
        } catch {
            this.opts.log?.warn?.(`[memory] costs-${month}.json is corrupt; starting a fresh month file`);
            this.state = { month, providers: {} };
        }
    }

    /** Resolve a provider's cap: recorded capUsd, else configured fallback, else default. */
    capFor(name: JudgeModelName): number {
        const recorded = this.state?.providers[name]?.capUsd;
        if (typeof recorded === 'number' && recorded >= 0) {
            return recorded;
        }
        const configured = this.opts.caps?.[name];
        if (typeof configured === 'number' && configured >= 0) {
            return configured;
        }
        return DEFAULT_JUDGE_CAPS[name];
    }

    /** Current month spend for a provider. */
    monthlySpend(name: JudgeModelName): number {
        return this.state?.providers[name]?.spentUsd ?? 0;
    }

    /** Whether a provider is capped/auto-disabled for this month. */
    isCapped(name: JudgeModelName): boolean {
        const p = this.state?.providers[name];
        if (p?.disabled) {
            return true;
        }
        return this.monthlySpend(name) >= this.capFor(name);
    }

    /** True when EVERY provider in `names` is capped (SEC-COST-01 all-capped pause). */
    allCapped(names: readonly JudgeModelName[]): boolean {
        if (names.length === 0) {
            return false;
        }
        return names.every((n) => this.isCapped(n));
    }

    /**
     * Record a completion's cost for a provider. When the accumulated
     * spend reaches the cap the provider is auto-disabled for the rest
     * of the month (logged, SEC-COST-01). Returns the new state.
     */
    async recordCost(name: JudgeModelName, costUsd: number): Promise<ProviderCostState> {
        await this.load();
        const month = this.currentMonth();
        const cap = this.capFor(name);
        const prev = this.state!.providers[name] ?? { spentUsd: 0, capUsd: cap, disabled: false };
        const spent = roundUsd(prev.spentUsd + Math.max(0, costUsd));
        const next: ProviderCostState = {
            spentUsd: spent,
            capUsd: prev.capUsd >= 0 ? prev.capUsd : cap,
            disabled: prev.disabled || spent >= cap,
        };
        this.state!.providers[name] = next;
        await this.save();
        if (next.disabled && !prev.disabled) {
            this.opts.log?.warn?.(
                `[memory] judge model "${name}" reached its monthly cap ($${cap.toFixed(2)}); ` +
                `auto-disabled until next month (SEC-COST-01)`,
            );
        }
        return next;
    }

    /** Persist the month state (0600 perms, SECURITY class 2 hygiene). */
    async save(): Promise<void> {
        await this.load();
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await writeFile(this.filePath(), JSON.stringify(this.state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    }

    /** Per-model summary for the T08 owner report (SEC-COST-02 — no keys). */
    summary(): { month: string; providers: Record<string, ProviderCostState> } {
        const providers: Record<string, ProviderCostState> = {};
        for (const name of Object.keys(DEFAULT_JUDGE_CAPS)) {
            const n = name as JudgeModelName;
            const p = this.state?.providers[name];
            providers[name] = {
                spentUsd: p?.spentUsd ?? 0,
                capUsd: p?.capUsd ?? this.capFor(n),
                disabled: p?.disabled ?? false,
            };
        }
        return { month: this.currentMonth(), providers };
    }
}

/** Round USD to 6 decimals to avoid float drift in the cost file. */
function roundUsd(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
}
