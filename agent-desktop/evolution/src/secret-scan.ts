/**
 * Secret-scan guard (SEC-LOG-02 / SEC-GEPA-08 / QL-1).
 *
 * Scans text for credential-shaped strings: env-var references for the
 * provider keys (OPENAI_/GEMINI_/DEEPSEEK_/ANTHROPIC_...), `sk-...` API
 * keys, Google `AIza...` keys, Telegram bot tokens, `KEY=value` /
 * `KEY: value` assignment forms for known secret names, and PEM private
 * key blocks.
 *
 * Usage:
 *   - library: `scanSecrets(text)` -> hits (deterministic, no side effects)
 *   - CI / CLI: `node --import tsx src/secret-scan.ts <file...>` — exit 0
 *     only when 0 hits (T10 §4.4 QL-1: 0 hits required on the dataset file).
 *
 * This scanner is deliberately stricter than the redactor (`src/redact.ts`
 * of agent-desktop): even a *reference* to an env var name is a hit,
 * because the dataset must contain no API keys, tokens, or
 * credential-shaped strings at all (SEC-GEPA-08).
 */

import { readFileSync } from 'node:fs';

export interface SecretHit {
    pattern: string;
    match: string;
    index: number;
}

/** Named, ordered scan patterns (name used in reports for greppability). */
export const SECRET_SCAN_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
    // Provider env-var references (QL-1: OPENAI_/GEMINI_/DEEPSEEK_ and
    // generic key shapes) — any occurrence, even without a value.
    { name: 'env-ref', re: /\b(?:OPENAI|GEMINI|DEEPSEEK|ANTHROPIC)[A-Z0-9_]*\b/g },
    // OpenAI / DeepSeek / generic sk-... API keys.
    { name: 'sk-key', re: /\bsk-[A-Za-z0-9_-]{8,}\b/g },
    // Google API keys: AIza<33 chars>.
    { name: 'google-key', re: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
    // Telegram bot tokens: <bot id>:<35+ char secret> (SEC-KEY-01).
    { name: 'telegram-token', re: /(?<!\d)\d{4,12}:[A-Za-z0-9_-]{35,}\b/g },
    // Assignment forms for known secret names with a non-trivial value
    // (e.g. API_KEY=..., DB_PASSWORD=..., OPENAI_API_KEY=...).
    { name: 'assignment', re: /\b(?:[A-Za-z_][A-Za-z0-9_]*_)?(?:API_?KEY|TOKEN|PASSWORD|SECRET)\b\s*[=:]\s*\S{6,}/gi },
    // PEM private-key blocks.
    { name: 'pem-key', re: /-----BEGIN (?:RSA |OPENSSH |EC |ENCRYPTED )?PRIVATE KEY-----/g },
];

/** Scan a string for secret-shaped content. Deterministic; no redaction here. */
export function scanSecrets(text: string): SecretHit[] {
    const hits: SecretHit[] = [];
    for (const { name, re } of SECRET_SCAN_PATTERNS) {
        for (const m of text.matchAll(re)) {
            hits.push({ pattern: name, match: m[0], index: m.index ?? -1 });
        }
    }
    return hits;
}

/** Scan every string value of a JSON value (used for dataset content). */
export function scanJsonValue(value: unknown, hits: SecretHit[] = []): SecretHit[] {
    if (typeof value === 'string') {
        hits.push(...scanSecrets(value));
    } else if (Array.isArray(value)) {
        for (const v of value) {
            scanJsonValue(v, hits);
        }
    } else if (typeof value === 'object' && value !== null) {
        for (const v of Object.values(value as Record<string, unknown>)) {
            scanJsonValue(v, hits);
        }
    }
    return hits;
}

/** Scan a file on disk. Returns {hits, bytes}. */
export function scanFile(path: string): { hits: SecretHit[]; bytes: number } {
    const buf = readFileSync(path);
    const hits = scanSecrets(buf.toString('utf8'));
    return { hits, bytes: buf.byteLength };
}

// ---- CLI ----
// `node --import tsx src/secret-scan.ts <file...>`
const isMain = process.argv[1]?.endsWith('secret-scan.ts') || process.argv[1]?.endsWith('secret-scan.js');
if (isMain) {
    const files = process.argv.slice(2);
    if (files.length === 0) {
        console.error('usage: secret-scan.ts <file...>');
        process.exit(2);
    }
    let total = 0;
    for (const f of files) {
        const { hits, bytes } = scanFile(f);
        total += hits.length;
        for (const h of hits) {
            console.error(`SECRET-SCAN HIT [${h.pattern}] ${f}:${h.index}: ${h.match}`);
        }
        console.error(`secret-scan: ${f}: ${hits.length} hit(s) over ${bytes} byte(s)`);
    }
    if (total > 0) {
        console.error(`secret-scan: FAIL — ${total} hit(s) (SEC-LOG-02 / QL-1 requires 0)`);
        process.exit(1);
    }
    console.error('secret-scan: PASS — 0 hits');
    process.exit(0);
}
