/**
 * Telegram bridge configuration (T08, plan #22 Q1/R7).
 *
 * Env surface (all optional — the bridge FAILS SAFE to sandbox mode
 * when nothing is configured; SEC-KEY-03 spirit):
 * - `TELEGRAM_BOT_TOKEN` — bot token. LIVE mode only; env only, never
 *   in logs/artifacts (SEC-KEY-01..03). When absent the bridge runs in
 *   sandbox/file mode (no network).
 * - `TELEGRAM_CHAT_ID` — chat id notified about consolidation events
 *   (SEC-COST-02 spend report). Comma-separated list allowed.
 * - `TELEGRAM_ALLOWED_CHAT_IDS` — chat ids allowed to issue `/memory`
 *   commands (default: same as TELEGRAM_CHAT_ID). Comma-separated.
 * - `TELEGRAM_API_BASE` — Bot API base URL (default
 *   `https://api.telegram.org`).
 * - `TELEGRAM_POLL_INTERVAL_MS` — getUpdates long-poll timeout (default
 *   2000 ms).
 * - `TELEGRAM_TIMEOUT_S` — per-request timeout in seconds (default 30).
 * - `TELEGRAM_SANDBOX_FILE` — sandbox transport inbox/outbox JSONL file
 *   (default `<memoryDir>/telegram-sandbox.jsonl`). In sandbox mode the
 *   transport reads commands from and writes replies to this file — no
 *   network, no token (CHẠY TRONG SANDBOX TRƯỚC, plan #22 T08).
 * - `TELEGRAM_MAX_MESSAGE_LENGTH` — truncation length for outbound
 *   messages (default 4000; Telegram hard limit 4096).
 *
 * Sandbox-first rule (plan #22 T08, acceptance criterion 2): the
 * integration MUST be validated in a sandbox/CI environment before any
 * live deployment. `loadTelegramConfig` therefore defaults to
 * `sandbox: true` unless `TELEGRAM_BOT_TOKEN` is present AND
 * `TELEGRAM_SANDBOX=0` (explicit opt-in for the owner's laptop, Q3).
 */

/** Thrown when the Telegram config is invalid. */
export class TelegramConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TelegramConfigError';
    }
}

/** Telegram bridge configuration. */
export interface TelegramConfig {
    /** Bot token (LIVE only; empty in sandbox mode — SEC-KEY-01). */
    botToken: string;
    /** Chat ids that receive consolidation notifications (SEC-COST-02). */
    notifyChatIds: string[];
    /** Chat ids allowed to issue `/memory` commands (empty = all). */
    allowedChatIds: string[];
    /** Bot API base URL (default https://api.telegram.org). */
    apiBase: string;
    /** getUpdates long-poll timeout in ms (default 2000). */
    pollIntervalMs: number;
    /** Per-request timeout in seconds (default 30). */
    timeoutS: number;
    /** True = sandbox/file transport (no network, no token) — default. */
    sandbox: boolean;
    /** Sandbox transport JSONL file (default `<memoryDir>/telegram-sandbox.jsonl`). */
    sandboxFile: string;
    /** Outbound message truncation length (default 4000, cap 4096). */
    maxMessageLength: number;
}

/** Parse `TELEGRAM_CHAT_ID`-style comma-separated chat ids. */
export function parseChatIds(value: string | undefined): string[] {
    if (!value || value.trim() === '') {
        return [];
    }
    const out: string[] = [];
    for (const raw of value.split(',')) {
        const id = raw.trim();
        if (id.length > 0) {
            out.push(id);
        }
    }
    return out;
}

/** Parse `TELEGRAM_POLL_INTERVAL_MS` (default 2000); invalid → fallback. */
export function parsePollIntervalMs(value: string | undefined, fallback = 2000): number {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n < 200 || n > 60_000) {
        return fallback;
    }
    return n;
}

/** Parse `TELEGRAM_TIMEOUT_S` (default 30); invalid → fallback. */
export function parseTimeoutS(value: string | undefined, fallback = 30): number {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || n > 300) {
        return fallback;
    }
    return n;
}

/** Parse `TELEGRAM_MAX_MESSAGE_LENGTH` (default 4000, cap 4096); invalid → fallback. */
export function parseMaxMessageLength(value: string | undefined, fallback = 4000): number {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n < 200 || n > 4096) {
        return fallback;
    }
    return n;
}

/**
 * Load the Telegram bridge configuration. `memoryDir` is used for the
 * default sandbox file path. Sandbox-first: without an explicit
 * `TELEGRAM_SANDBOX=0` + `TELEGRAM_BOT_TOKEN` the bridge stays in
 * sandbox mode (CHẠY TRONG SANDBOX TRƯỚC, plan #22 T08).
 */
export function loadTelegramConfig(
    env: NodeJS.ProcessEnv = process.env,
    memoryDir = 'memory',
): TelegramConfig {
    const botToken = env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
    const notifyChatIds = parseChatIds(env.TELEGRAM_CHAT_ID);
    const configuredAllowed = parseChatIds(env.TELEGRAM_ALLOWED_CHAT_IDS);
    const allowedChatIds = configuredAllowed.length > 0 ? configuredAllowed : [...notifyChatIds];
    const apiBase = env.TELEGRAM_API_BASE?.trim() || 'https://api.telegram.org';
    const sandboxFile = env.TELEGRAM_SANDBOX_FILE?.trim() || `${memoryDir}/telegram-sandbox.jsonl`;

    // Sandbox-first (plan #22 T08): live mode requires an explicit
    // `TELEGRAM_SANDBOX=0` AND a bot token. Anything else → sandbox.
    // An explicit `TELEGRAM_SANDBOX=0` without a token is a
    // configuration error (the operator asked for live but SEC-KEY-01
    // forbids a token-less live transport).
    const sandboxOverride = env.TELEGRAM_SANDBOX?.trim();
    const wantsLive = sandboxOverride === '0';
    if (wantsLive && botToken === '') {
        throw new TelegramConfigError(
            'live Telegram mode requires TELEGRAM_BOT_TOKEN (SEC-KEY-01); ' +
            'leave TELEGRAM_SANDBOX unset for sandbox mode',
        );
    }
    const sandbox = !wantsLive;

    return {
        botToken,
        notifyChatIds,
        allowedChatIds,
        apiBase,
        pollIntervalMs: parsePollIntervalMs(env.TELEGRAM_POLL_INTERVAL_MS),
        timeoutS: parseTimeoutS(env.TELEGRAM_TIMEOUT_S),
        sandbox,
        sandboxFile,
        maxMessageLength: parseMaxMessageLength(env.TELEGRAM_MAX_MESSAGE_LENGTH),
    };
}
