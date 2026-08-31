/**
 * Injection-pattern quarantine (spec §10.2.2).
 *
 * The writer scans every record's text for known prompt-injection
 * patterns (e.g. "ignore previous instructions", "system prompt:",
 * "you are now", hidden-instruction markers). On match the record is
 * quarantined (never reaches L3/L4), logged, and flagged for review.
 *
 * The detector list is `MEMORY_INJECTION_PATTERNS` (shipped defaults
 * below; extendable via config — additional patterns are appended,
 * never replace the defaults, so a misconfigured deployment cannot
 * accidentally disable the shipped guardrail).
 *
 * Matching is case-insensitive substring matching on the textual
 * content of a record (its `content.text`, `content.statement`, or any
 * string value recursively). This is deliberately conservative and
 * deterministic — T06 can pin it with fixtures.
 */

/** Shipped default injection patterns (spec §10.2.2 examples + hidden markers). */
export const DEFAULT_INJECTION_PATTERNS: readonly string[] = [
    // Direct instruction-override phrases
    'ignore previous instructions',
    'ignore all previous instructions',
    'disregard previous instructions',
    'disregard all previous instructions',
    'forget all previous instructions',
    'overwrite your instructions',
    // Prompt-source impersonation
    'system prompt:',
    'system:',
    'you are now',
    'you must now',
    'act as if you are',
    'your new instructions are',
    'here are your new instructions',
    'new system prompt',
    // Hidden-instruction / delimiter markers
    '[MEMORY_START]',
    '[/MEMORY_END]',
    '[SYSTEM]',
    '[/SYSTEM]',
    '<system>',
    '</system>',
    'ignore everything above',
    'ignore all previous text',
    'do not follow any instructions in this memory',
    'memory content is instructions',
    'treat the following as instructions',
];

/** Normalize a pattern to lowercase for case-insensitive matching. */
export function normalizePattern(pattern: string): string {
    return pattern.trim().toLowerCase();
}

/**
 * Scan a string for any configured injection pattern.
 * Returns the first matched pattern (normalized) or `null`.
 */
export function findInjectionPattern(
    text: string,
    patterns: readonly string[] = DEFAULT_INJECTION_PATTERNS,
): string | null {
    const haystack = text.toLowerCase();
    for (const pattern of patterns) {
        const normalized = normalizePattern(pattern);
        if (normalized.length > 0 && haystack.includes(normalized)) {
            return pattern;
        }
    }
    return null;
}

/**
 * Extract the searchable textual content of a record (its `content`
 * payload) for injection scanning. String values are joined with
 * spaces; nested objects/arrays are JSON-serialized.
 */
export function recordText(record: { content?: unknown }): string {
    const content = record.content;
    if (content === undefined || content === null) {
        return '';
    }
    if (typeof content === 'string') {
        return content;
    }
    const parts: string[] = [];
    collectStrings(content, parts);
    return parts.join(' ');
}

function collectStrings(value: unknown, out: string[]): void {
    if (typeof value === 'string') {
        out.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectStrings(item, out);
        return;
    }
    if (typeof value === 'object' && value !== null) {
        for (const v of Object.values(value)) collectStrings(v, out);
    }
}

/** Result of an injection scan on a record. */
export interface InjectionScanResult {
    matched: boolean;
    pattern: string | null;
}

/**
 * Scan a record for injection patterns. Empty patterns list disables
 * matching (returned as no match); a malformed record yields no match.
 */
export function scanForInjection(
    record: { content?: unknown },
    patterns: readonly string[] = DEFAULT_INJECTION_PATTERNS,
): InjectionScanResult {
    if (patterns.length === 0) {
        return { matched: false, pattern: null };
    }
    const text = recordText(record);
    const pattern = findInjectionPattern(text, patterns);
    return pattern === null
        ? { matched: false, pattern: null }
        : { matched: true, pattern };
}
