/**
 * Secret redaction for the judge/reflection path (SEC-LOG-01, ADR-010)
 * and the Telegram bridge (T08, SEC-KEY-01..03).
 *
 * `docs/security-review-memory.md` §7.3: the judge/reflection path MUST
 * redact request content before logging; run logs never contain API keys
 * (SECURITY.md class 2). This helper masks key-shaped strings (OpenAI
 * `sk-...`, DeepSeek `sk-...`, Google `AIza...`, Telegram bot tokens
 * `123456:ABC-DEF...`, generic `KEY=value` assignments) before any
 * log/artifact write.
 *
 * The provider abstraction additionally NEVER serializes keys
 * (SEC-KEY-02): keys are read from the environment at call time and put
 * only in the HTTP `Authorization` header — never in prompts, verdicts,
 * L2 records or logs. The Telegram bridge (T08) builds its Bot API URLs
 * at call time and logs only redacted text (SEC-KEY-01/SEC-LOG-01).
 */

/** Mask a single occurrence of a secret-looking token. */
function maskMatch(match: string): string {
    if (match.length <= 8) {
        return '***';
    }
    return `${match.slice(0, 4)}…${match.slice(-4)} (redacted)`;
}

/** Regexes for common key shapes (SEC-LOG-01, SECURITY.md class 2). */
const SECRET_PATTERNS: readonly RegExp[] = [
    // OpenAI / DeepSeek / generic sk-... API keys.
    /\bsk-[A-Za-z0-9_-]{8,}\b/g,
    // Google API keys: AIza<33 chars>.
    /\bAIza[0-9A-Za-z_-]{20,}\b/g,
    // Telegram bot tokens: <bot id (4-12 digits)>:<35+ char secret> (T08,
    // SEC-KEY-01 — Telegram Bot API `bot<token>` URLs must never be
    // logged). `(?<!\d)` only excludes splitting a longer digit run; the
    // token often follows `bot` with no separator, so no letter boundary.
    /(?<!\d)\d{4,12}:[A-Za-z0-9_-]{35,}\b/g,
    // Assignment forms: KEY=value / KEY: value for known secret names.
    /\b(?:OPENAI|GEMINI|DEEPSEEK|ANTHROPIC|GITHUB|GITLAB|REDMINE|ODOO|POSTGRES|PG|TELEGRAM)_?[A-Z_]*(?:API_?KEY|TOKEN|PASSWORD|SECRET)\s*[=:]\s*[^\s,;]+/gi,
];

/**
 * Redact secret-shaped substrings from a string (log lines, run records,
 * report text). Deterministic and idempotent — safe to apply twice.
 */
export function redactSecrets(text: string): string {
    if (typeof text !== 'string' || text.length === 0) {
        return text;
    }
    let out = text;
    for (const re of SECRET_PATTERNS) {
        out = out.replace(re, (m) => {
            // Assignment forms keep the key name visible (so logs stay
            // greppable) but mask the value.
            const eq = /^([A-Za-z_][A-Za-z0-9_]*\s*[=:]\s*)(.*)$/.exec(m);
            if (eq) {
                return `${eq[1]}${maskMatch(eq[2])}`;
            }
            return maskMatch(m);
        });
    }
    return out;
}

/**
 * Redact the secret-bearing fields of a JSON value before serializing it
 * to a log/artifact. Only string values are touched; the value is
 * returned unchanged if it is not an object.
 */
export function redactJsonValue(value: unknown): unknown {
    if (typeof value === 'string') {
        return redactSecrets(value);
    }
    if (Array.isArray(value)) {
        return value.map((v) => redactJsonValue(v));
    }
    if (typeof value === 'object' && value !== null) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = redactJsonValue(v);
        }
        return out;
    }
    return value;
}
