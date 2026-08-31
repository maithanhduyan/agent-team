/**
 * Agentic retrieval budget (spec §7.3, US-MEM-006 AC-2).
 *
 * Long-history retrieval is a **usage protocol for the model**: the
 * agent queries turn by turn (`search_memory` → `grep_logs`) until it
 * has enough evidence or reaches the per-turn budget
 * (`MEMORY_MAX_TOOL_CALLS_PER_TURN`, default 5). The tools themselves
 * are cheap, deterministic, and safe to call repeatedly — this module
 * only tracks the budget and exposes it to the caller (T08 bridge /
 * runner), which enforces it around each turn's tool calls.
 *
 * Budget semantics: the budget is **per turn** — a new turn gets a fresh
 * budget; `record()` beyond the max throws (misuse must be loud, not
 * silently ignored).
 */

/** Default per-turn tool-call budget (spec §7.3 / §11). */
export const DEFAULT_MAX_TOOL_CALLS_PER_TURN = 5;

/** Thrown when a call would exceed the per-turn budget (§7.3). */
export class ToolCallBudgetExceededError extends Error {
    constructor(max: number) {
        super(
            `agentic retrieval budget exceeded: at most ${max} memory tool call(s) per turn ` +
            `(MEMORY_MAX_TOOL_CALLS_PER_TURN, spec §7.3)`,
        );
        this.name = 'ToolCallBudgetExceededError';
    }
}

/** Tracks memory tool calls within one turn (§7.3). */
export class ToolCallBudget {
    private readonly maxCalls: number;
    private usedCalls: number;

    constructor(maxCalls: number = DEFAULT_MAX_TOOL_CALLS_PER_TURN) {
        if (!Number.isInteger(maxCalls) || maxCalls <= 0) {
            throw new Error(`invalid budget: maxCalls must be a positive integer, got ${maxCalls}`);
        }
        this.maxCalls = maxCalls;
        this.usedCalls = 0;
    }

    get max(): number {
        return this.maxCalls;
    }

    get used(): number {
        return this.usedCalls;
    }

    get remaining(): number {
        return Math.max(0, this.maxCalls - this.usedCalls);
    }

    isExhausted(): boolean {
        return this.usedCalls >= this.maxCalls;
    }

    /** Record one tool call; throws when the budget is exhausted (§7.3). */
    record(): void {
        if (this.usedCalls >= this.maxCalls) {
            throw new ToolCallBudgetExceededError(this.maxCalls);
        }
        this.usedCalls += 1;
    }

    /** True if a call may still be recorded; records it when possible. */
    tryRecord(): boolean {
        if (this.usedCalls >= this.maxCalls) {
            return false;
        }
        this.usedCalls += 1;
        return true;
    }
}
