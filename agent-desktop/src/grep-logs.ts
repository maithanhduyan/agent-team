/**
 * `grep_logs` tool (spec §7.2, ADR-005, US-MEM-004).
 *
 * Raw, unranked line search over memory files (and, with `files: "runs"`,
 * the DSH run logs). This is the forensic / agentic retrieval tool — the
 * agent uses it to verify exact text, find raw context, and follow leads
 * across long histories.
 *
 * Behavioral contract (spec §7.2):
 * - `files: "memory"` searches `sessions.jsonl` + archives + `core.md`;
 *   `files: "runs"` searches DSH run logs (`.agent-team/runs/*.log`);
 *   `all` = both.
 * - Regex is **RE2-safe** (no catastrophic backtracking); invalid regex →
 *   error. We run on JS's backtracking engine, so `assertRe2Safe`
 *   rejects the constructs RE2 does not support (lookarounds,
 *   backreferences) plus the classic catastrophic nested-quantifier
 *   shapes (`(a+)+`, `(a*)*`, …). The subset is deliberately
 *   conservative: safe-but-unusual patterns may be rejected too.
 * - Unranked: results in file/line order, capped by `limit` (context
 *   lines never count toward the cap).
 * - `since` (ISO 8601) filters matches: the line's timestamp (JSONL
 *   record `ts`, or the first ISO timestamp found in the line) must be
 *   `>= since`; lines with no determinable timestamp are excluded when
 *   `since` is set.
 * - No matches → empty `matches` (not an error).
 *
 * SEC-MEM-01: matches must be rendered into prompts via
 * `renderGrepMatches` (see `render.ts`) — never plain tool output.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ISOTimestamp } from './types.js';

/** Thrown on invalid `grep_logs` parameters (invalid/unsafe regex, bad range, …). */
export class GrepLogsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GrepLogsError';
    }
}

export type GrepFiles = 'memory' | 'runs' | 'all';

export interface GrepLogsParams {
    /** Required regex pattern (RE2-safe subset). */
    pattern: string;
    /** Scope of files to search; default "memory". */
    files?: GrepFiles;
    /** Case-sensitive matching; default false. */
    case_sensitive?: boolean;
    /** Context lines before/after each match; default 2, range 0..10. */
    context_lines?: number;
    /** Max matches returned; default 100. */
    limit?: number;
    /** Lower bound on the line's timestamp (ISO 8601 UTC); default null. */
    since?: ISOTimestamp | null;
}

/** One match (spec §7.2). */
export interface GrepMatch {
    file: string;
    line: number;
    ts: ISOTimestamp | null;
    text: string;
    before: string[];
    after: string[];
}

export interface GrepLogsMeta {
    took_ms: number;
    count: number;
    pattern: string;
}

export interface GrepLogsOutput {
    matches: GrepMatch[];
    meta: GrepLogsMeta;
}

export interface GrepLogsOptions {
    /** DSH run-log directory (spec §7.2, `.agent-team/runs`). */
    runsDir: string;
}

/** Defaults per spec §7.2. */
export const DEFAULT_CONTEXT_LINES = 2;
export const DEFAULT_LIMIT = 100;
export const MAX_CONTEXT_LINES = 10;
export const MAX_LIMIT = 1000;

/** ISO 8601 UTC with optional ms precision, found anywhere in a line. */
const ISO_IN_LINE_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/;

/** An unbounded quantifier: `*`, `+`, `?`, or `{n,}` (no upper bound). */
const UNBOUNDED_QUANTIFIER = /[*+?]|\{\d*,\}/;

/**
 * Validate that a pattern is RE2-safe (spec §7.2: "RE2-safe, no
 * catastrophic backtracking"). Returns the normalized error message, or
 * `null` when the pattern is accepted. Conservative by design.
 */
export function re2SafetyError(pattern: string): string | null {
    if (pattern.trim() === '') {
        return 'empty pattern: `pattern` must be a non-empty regex';
    }
    // Compile check first (also catches unterminated classes/groups).
    try {
        new RegExp(pattern, 'u');
    } catch (err) {
        return `invalid regex: ${(err as Error).message}`;
    }
    // RE2 does not support lookarounds.
    if (/(\(\?[=!<])/.test(pattern)) {
        return 'unsafe regex: lookarounds (?= (?! (?<= (?<! are not RE2-safe';
    }
    // Numeric backreferences (\1 …) are not RE2; named ones too.
    if (/\\(\d)/.test(pattern)) {
        return 'unsafe regex: numeric backreferences (\\1 …) are not RE2-safe';
    }
    if (/\\k[<{]/.test(pattern)) {
        return 'unsafe regex: named backreferences (\\k<name>) are not RE2-safe';
    }
    // Possessive quantifiers (a++, a*+, a?+, a{2,3}+) are not valid in JS
    // at all — the compile check above already rejects them. Bounded
    // repetition is fine. (`{L}` inside `\p{L}` is a property escape,
    // not a quantifier, so it must not be treated as one.)
    // Catastrophic backtracking shapes: a quantified group/class that
    // itself contains an unbounded quantifier — `(a+)+`, `(a*)*`, `(a|b+)*`.
    if (hasNestedQuantifier(pattern)) {
        return 'unsafe regex: nested unbounded quantifiers (e.g. (a+)+) can cause catastrophic backtracking';
    }
    return null;
}

/**
 * Detect `X+`/`X*`/`X?`/`X{n,}` applied to a group or character class
 * whose body contains an unbounded quantifier (class bodies are scanned
 * literally — `+` inside `[...]` is a literal character, not a
 * quantifier, and is exempted).
 */
function hasNestedQuantifier(pattern: string): boolean {
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i];
        if (ch !== ')' && ch !== ']') continue;
        const next = pattern[i + 1];
        const quantified = next === '*' || next === '+' || next === '?' ||
            (next === '{' && isUnboundedBraces(pattern, i + 1));
        if (!quantified) continue;
        const open = findMatchingOpen(pattern, i);
        if (open === -1) continue;
        const inner = pattern.slice(open + 1, i)
            .replace(/\\./g, '')          // drop escaped chars
            .replace(/\[[^\]]*\]/g, '');  // drop char-class bodies (literal)
        if (UNBOUNDED_QUANTIFIER.test(inner)) {
            return true;
        }
    }
    return false;
}

/** True if `{...}` starting at `at` is an unbounded repeat `{n,}`. */
function isUnboundedBraces(pattern: string, at: number): boolean {
    const end = pattern.indexOf('}', at);
    if (end === -1) return false;
    const body = pattern.slice(at + 1, end);
    return /^\d*,$/.test(body);
}

/** Find the index of the open bracket matching `closeIdx` (')' or ']'). */
function findMatchingOpen(pattern: string, closeIdx: number): number {
    const close = pattern[closeIdx];
    const open = close === ')' ? '(' : '[';
    let depth = 0;
    for (let i = closeIdx; i >= 0; i--) {
        if (pattern[i] === '\\') {
            i--; // skip escaped char
            continue;
        }
        if (pattern[i] === close) depth += 1;
        else if (pattern[i] === open) {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** List memory files to search: archives (asc) + current file + core.md. */
export async function listMemoryFiles(memoryDir: string): Promise<string[]> {
    let entries: string[];
    try {
        entries = await readdir(memoryDir);
    } catch {
        entries = [];
    }
    const archives = entries
        .filter((name) => /^sessions-\d{8}\.jsonl$/.test(name))
        .sort();
    const files = [...archives, 'sessions.jsonl', 'core.md'];
    return files.map((name) => path.join(memoryDir, name));
}

/** List DSH run-log files (`.agent-team/runs/*.log`), sorted for determinism. */
export async function listRunLogFiles(runsDir: string): Promise<string[]> {
    let entries: string[];
    try {
        entries = await readdir(runsDir);
    } catch {
        return [];
    }
    return entries
        .filter((name) => name.endsWith('.log'))
        .sort()
        .map((name) => path.join(runsDir, name));
}

/** Extract the line's timestamp: JSON `ts` field for JSONL, else first ISO in the line. */
export function lineTimestamp(line: string): ISOTimestamp | null {
    const trimmed = line.trim();
    if (trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed) as { ts?: unknown };
            if (typeof parsed.ts === 'string' && ISO_IN_LINE_RE.test(parsed.ts)) {
                return parsed.ts;
            }
        } catch {
            // fall through to the ISO scan
        }
    }
    const match = ISO_IN_LINE_RE.exec(trimmed);
    return match ? `${match[0]}` : null;
}

/** Validate params; returns normalized values (throws GrepLogsError). */
export function validateGrepParams(params: GrepLogsParams): Required<
    Pick<GrepLogsParams, 'pattern' | 'files' | 'case_sensitive' | 'context_lines' | 'limit' | 'since'>
> {
    const pattern = typeof params.pattern === 'string' ? params.pattern : '';
    const unsafe = re2SafetyError(pattern);
    if (unsafe !== null) {
        throw new GrepLogsError(unsafe);
    }

    const files = params.files ?? 'memory';
    if (files !== 'memory' && files !== 'runs' && files !== 'all') {
        throw new GrepLogsError(`invalid files "${String(files)}": expected "memory" | "runs" | "all" (spec §7.2)`);
    }

    const caseSensitive = params.case_sensitive ?? false;

    const contextLines = params.context_lines ?? DEFAULT_CONTEXT_LINES;
    if (!Number.isInteger(contextLines) || contextLines < 0 || contextLines > MAX_CONTEXT_LINES) {
        throw new GrepLogsError(`invalid context_lines: must be an integer in [0, ${MAX_CONTEXT_LINES}], got ${contextLines}`);
    }

    const limit = params.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
        throw new GrepLogsError(`invalid limit: must be an integer in [1, ${MAX_LIMIT}], got ${limit}`);
    }

    const since = params.since ?? null;
    if (since !== null && !Number.isFinite(Date.parse(since))) {
        throw new GrepLogsError(`invalid since: "${since}" is not an ISO 8601 timestamp`);
    }

    return { pattern, files, case_sensitive: caseSensitive, context_lines: contextLines, limit, since };
}

/** Search one file's lines; pushes matches into `out` until `limit` is reached. */
function grepFile(
    filePath: string,
    lines: string[],
    re: RegExp,
    contextLines: number,
    limit: number,
    sinceMs: number | null,
    out: GrepMatch[],
): void {
    const matchedLines = new Set<number>();
    for (let i = 0; i < lines.length && out.length < limit; i++) {
        if (re.test(lines[i])) {
            matchedLines.add(i);
        }
    }
    if (matchedLines.size === 0) {
        return;
    }
    const baseName = path.basename(filePath);
    // Deterministic ascending line order.
    const sorted = [...matchedLines].sort((a, b) => a - b);
    for (const idx of sorted) {
        if (out.length >= limit) break;
        const text = lines[idx];
        const ts = lineTimestamp(text);
        if (sinceMs !== null) {
            const tsMs = ts === null ? null : Date.parse(ts);
            if (tsMs === null || tsMs < sinceMs) {
                continue; // cannot verify recency, or older than `since`
            }
        }
        const before = idx > 0 ? lines.slice(Math.max(0, idx - contextLines), idx) : [];
        const after = idx + 1 < lines.length ? lines.slice(idx + 1, idx + 1 + contextLines) : [];
        out.push({ file: baseName, line: idx + 1, ts, text, before, after });
    }
}

/**
 * `grep_logs` — raw unranked regex search over memory files and/or DSH
 * run logs (spec §7.2). Results in file/line order, capped by `limit`.
 */
export async function grepLogs(
    memoryDir: string,
    params: GrepLogsParams,
    options: GrepLogsOptions,
): Promise<GrepLogsOutput> {
    const started = Date.now();
    const v = validateGrepParams(params);
    const flags = v.case_sensitive ? 'u' : 'iu';
    const re = new RegExp(v.pattern, flags);
    const sinceMs = v.since === null ? null : Date.parse(v.since);

    const targets: string[] = [];
    if (v.files === 'memory' || v.files === 'all') {
        targets.push(...(await listMemoryFiles(memoryDir)));
    }
    if (v.files === 'runs' || v.files === 'all') {
        targets.push(...(await listRunLogFiles(options.runsDir)));
    }

    const matches: GrepMatch[] = [];
    for (const filePath of targets) {
        if (matches.length >= v.limit) break;
        let content: string;
        try {
            content = await readFile(filePath, 'utf8');
        } catch {
            continue; // missing/unreadable file is skipped, not an error
        }
        const lines = content.split('\n');
        // Drop the trailing empty element from a final newline (keeps
        // line numbers aligned with the file).
        if (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }
        grepFile(filePath, lines, re, v.context_lines, v.limit, sinceMs, matches);
    }

    return {
        matches,
        meta: { took_ms: Date.now() - started, count: matches.length, pattern: v.pattern },
    };
}
