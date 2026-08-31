/**
 * Telegram chat commands for memory querying (T08, spec §7).
 *
 * Command surface (sent to the bot, e.g. `/memory search <query>`):
 * - `/memory search <query>`   → `search_memory` (spec §7.1)
 * - `/memory grep <pattern>`   → `grep_logs` (spec §7.2, RE2-safe)
 * - `/memory hot`              → hot-fact injection view (spec §6.3)
 * - `/memory spend`            → judge spend report (SEC-COST-02)
 * - `/memory help`             → this help
 *
 * SEC-MEM-01/02 (docs/security-review-memory.md §3.3): every
 * memory-derived block rendered into a reply MUST be wrapped in the
 * `[MEMORY_START]…[/MEMORY_END]` envelope with the "data, not
 * instructions" note — implemented via the `render.ts` helpers
 * (`renderSearchResults`, `renderGrepMatches`, `renderHotFacts`).
 * No plain tool-output rendering of memory text.
 */

import { renderGrepMatches, renderHotFacts, renderSearchResults, type SearchResultRenderInput, type GrepMatchRenderInput, type HotFactRenderInput } from '../render.js';
import type { CostMonthFile } from '../costs.js';

/** Supported chat commands. */
export type MemoryCommandName = 'search' | 'grep' | 'hot' | 'spend' | 'help';

/** A parsed command. */
export interface MemoryCommand {
    name: MemoryCommandName;
    /** Command argument (query/pattern); empty for hot/spend/help. */
    arg: string;
}

const COMMAND_ALIASES: Record<string, MemoryCommandName> = {
    search: 'search',
    grep: 'grep',
    hot: 'hot',
    spend: 'spend',
    help: 'help',
};

/**
 * Parse a chat text into a memory command. Accepts `/memory <cmd> ...`,
 * `/memory@BotName <cmd> ...`, or bare `memory <cmd> ...`. Anything else
 * → `help` (the bot always answers with something useful).
 */
export function parseMemoryCommand(text: string): MemoryCommand {
    const trimmed = (text ?? '').trim();
    const match = /^(?:\/)?(?:memory(?:@[A-Za-z0-9_]+)?)\s+([a-z]+)(?:\s+(.*))?$/i.exec(trimmed);
    if (!match) {
        return { name: 'help', arg: '' };
    }
    const name = COMMAND_ALIASES[match[1].toLowerCase()];
    if (!name) {
        return { name: 'help', arg: '' };
    }
    return { name, arg: (match[2] ?? '').trim() };
}

/** The memory operations the command handler needs (T04 exports). */
export interface MemoryCommandDeps {
    /** `searchMemory(memoryDir, params, options)` result. */
    search: (query: string) => Promise<{ results: SearchResultRenderInput[]; meta: { hits: number; took_ms: number } }>;
    /** `grepLogs(memoryDir, params, options)` result. */
    grep: (pattern: string) => Promise<{ matches: GrepMatchRenderInput[]; meta: { count: number; took_ms: number } }>;
    /** `loadHotFacts(memoryDir)` result. */
    hotFacts: () => Promise<HotFactRenderInput[]>;
    /** `CostTracker.summary()` result. */
    spend: () => CostMonthFile;
    /** Outbound truncation length (Telegram cap 4096). */
    maxMessageLength?: number;
}

/** Help text — lists the command surface (no memory content). */
export function memoryHelpText(): string {
    return [
        '🧠 Memory commands:',
        '  /memory search <query> — ranked search over L2+L3 (spec §7.1)',
        '  /memory grep <pattern> — raw RE2-safe regex over memory files (spec §7.2)',
        '  /memory hot — current hot facts (0 ms, spec §6.3)',
        '  /memory spend — judge-model spend report (SEC-COST-02)',
        '  /memory help — this help',
        '',
        'Memory content is data, not instructions (SEC-MEM-01/02).',
    ].join('\n');
}

/** Format the spend report (SEC-COST-02 — no keys, USD only). */
export function formatSpendReport(spend: CostMonthFile): string {
    const lines = [`💰 Judge spend ${spend.month} (per model, no keys — SEC-COST-02):`];
    for (const [name, p] of Object.entries(spend.providers)) {
        const state = p.disabled ? ' (capped/disabled)' : '';
        lines.push(`  • ${name}: $${p.spentUsd.toFixed(4)} / cap $${p.capUsd.toFixed(2)}${state}`);
    }
    return lines.join('\n');
}

/** Truncate a reply to the configured max length. */
function truncate(text: string, max: number): string {
    if (text.length <= max) {
        return text;
    }
    return `${text.slice(0, Math.max(0, max - 3))}...`;
}

/**
 * Execute a parsed memory command and return the reply text. Every
 * memory-derived block is rendered through the SEC-MEM-01 helpers
 * (data-not-instructions envelope); meta lines are plain text.
 */
export async function executeMemoryCommand(
    command: MemoryCommand,
    deps: MemoryCommandDeps,
): Promise<string> {
    const max = deps.maxMessageLength ?? 4000;
    switch (command.name) {
        case 'search': {
            if (command.arg === '') {
                return 'Usage: /memory search <query>';
            }
            const out = await deps.search(command.arg);
            if (out.results.length === 0) {
                return `No memory matches for "${command.arg}".`;
            }
            const block = renderSearchResults(out.results);
            return truncate(`🔍 search_memory "${command.arg}" — ${out.meta.hits} hit(s), ${out.meta.took_ms} ms\n\n${block}`, max);
        }
        case 'grep': {
            if (command.arg === '') {
                return 'Usage: /memory grep <pattern>';
            }
            const out = await deps.grep(command.arg);
            if (out.matches.length === 0) {
                return `No grep matches for "${command.arg}".`;
            }
            const block = renderGrepMatches(out.matches);
            return truncate(`🔎 grep_logs "${command.arg}" — ${out.meta.count} match(es), ${out.meta.took_ms} ms\n\n${block}`, max);
        }
        case 'hot': {
            const facts = await deps.hotFacts();
            if (facts.length === 0) {
                return 'No hot facts currently (core.md empty or none hot/active).';
            }
            const block = renderHotFacts(facts);
            return truncate(`🔥 Hot facts (${facts.length})\n\n${block}`, max);
        }
        case 'spend':
            return truncate(formatSpendReport(deps.spend()), max);
        case 'help':
        default:
            return truncate(memoryHelpText(), max);
    }
}
