/**
 * Telegram transport abstraction (T08).
 *
 * Two implementations share one contract:
 * - `HttpTelegramTransport` — the real Telegram Bot API over HTTPS
 *   (LIVE mode, owner's laptop per Q3). The bot token is used ONLY to
 *   build the per-request URL at call time and is never logged,
 *   serialized or stored (SEC-KEY-01..03); errors are redacted with
 *   `redactSecrets` before logging (SEC-LOG-01).
 * - `SandboxTelegramTransport` — a JSONL-file transport (SANDBOX mode,
 *   CHẠY TRONG SANDBOX TRƯỚC per plan #22 T08): inbound commands are
 *   read from a file, outbound messages are appended to the same file.
 *   No network, no token — this is what CI/this workspace validates.
 *
 * Both transport outbound messages as `{ts, chat_id, text}` JSON lines
 * (the sandbox file doubles as the evidence log).
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { redactSecrets } from '../redact.js';

/** One inbound Telegram update (Bot API `getUpdates` item). */
export interface TelegramUpdate {
    update_id: number;
    message?: {
        message_id: number;
        chat: { id: string; type?: string };
        from?: { id?: string; username?: string; first_name?: string };
        text?: string;
        date?: number;
    };
}

/** One outbound Telegram message as persisted by the bridge. */
export interface TelegramOutbound {
    ts: string;
    chat_id: string;
    text: string;
    /** True when the text was truncated to `maxMessageLength`. */
    truncated?: boolean;
}

/** Transport contract. */
export interface TelegramTransport {
    readonly mode: 'live' | 'sandbox';
    /** Fetch pending updates with update_id > offset (long-poll). */
    getUpdates(offset: number): Promise<TelegramUpdate[]>;
    /** Send one message to a chat. Throws on transport failure. */
    sendMessage(chatId: string, text: string): Promise<{ ok: boolean }>;
    /** Drain any transport-level resources (no-op for both impls). */
    close(): Promise<void>;
}

/** Options for `HttpTelegramTransport`. */
export interface HttpTelegramTransportOptions {
    botToken: string;
    apiBase?: string;
    /** getUpdates long-poll timeout in ms (default 2000). */
    pollIntervalMs?: number;
    /** Per-request timeout in seconds (default 30). */
    timeoutS?: number;
    /** Injectable fetch (tests); default global fetch. */
    fetchImpl?: typeof fetch;
    /** Logger (default console). */
    log?: Pick<Console, 'warn' | 'info' | 'debug' | 'error'>;
}

/** Truncate a message to Telegram's 4096-char hard limit. */
export function truncateMessage(text: string, maxLength: number): { text: string; truncated: boolean } {
    if (text.length <= maxLength) {
        return { text, truncated: false };
    }
    return { text: `${text.slice(0, Math.max(0, maxLength - 3))}...`, truncated: true };
}

/** Real Telegram Bot API transport (LIVE mode, owner laptop Q3). */
export class HttpTelegramTransport implements TelegramTransport {
    readonly mode = 'live' as const;
    private readonly opts: Required<Pick<HttpTelegramTransportOptions, 'botToken'>> &
        HttpTelegramTransportOptions;
    private readonly log: Pick<Console, 'warn' | 'info' | 'debug' | 'error'>;

    constructor(options: HttpTelegramTransportOptions) {
        this.opts = { apiBase: 'https://api.telegram.org', pollIntervalMs: 2000, timeoutS: 30, ...options };
        this.log = options.log ?? console;
    }

    /** Build the method URL (token in path per Bot API; never logged). */
    private apiUrl(method: string): string {
        return `${this.opts.apiBase}/bot${this.opts.botToken}/${method}`;
    }

    private async request<T>(method: string, body: Record<string, unknown>): Promise<T> {
        const fetchImpl = this.opts.fetchImpl ?? fetch;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.opts.timeoutS! * 1000);
        try {
            const res = await fetchImpl(this.apiUrl(method), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            const data = (await res.json()) as { ok?: boolean; description?: string; result?: T };
            if (!data.ok) {
                // SEC-LOG-01: the description may echo the token URL.
                throw new Error(`Telegram API ${method} failed: ${redactSecrets(data.description ?? `HTTP ${res.status}`)}`);
            }
            return data.result as T;
        } finally {
            clearTimeout(timer);
        }
    }

    async getUpdates(offset: number): Promise<TelegramUpdate[]> {
        const result = await this.request<TelegramUpdate[]>('getUpdates', {
            offset,
            timeout: Math.max(1, Math.round(this.opts.pollIntervalMs! / 1000)),
            allowed_updates: ['message'],
        });
        return result ?? [];
    }

    async sendMessage(chatId: string, text: string): Promise<{ ok: boolean }> {
        await this.request<{ message_id: number }>('sendMessage', {
            chat_id: chatId,
            text,
            disable_web_page_preview: true,
        });
        return { ok: true };
    }

    async close(): Promise<void> {
        // No persistent resources.
    }
}

/** Options for `SandboxTelegramTransport`. */
export interface SandboxTelegramTransportOptions {
    /** JSONL file: inbound command lines + outbound message appends. */
    file: string;
    /** Injectable clock (tests). */
    now?: () => Date;
    /** Logger (default console). */
    log?: Pick<Console, 'warn' | 'info' | 'debug' | 'error'>;
}

/**
 * Sandbox/file transport (CHẠY TRONG SANDBOX TRƯỚC, plan #22 T08).
 *
 * Inbound: every JSON line is a TelegramUpdate. Lines with
 * `update_id <= offset` are skipped (already handled). The file is
 * never consumed/deleted — it stays as the sandbox evidence log.
 *
 * Outbound: messages are appended as `{ts, chat_id, text}` JSON lines
 * to the same file (and echoed to the log). No network, no token.
 */
export class SandboxTelegramTransport implements TelegramTransport {
    readonly mode = 'sandbox' as const;
    private readonly opts: Required<Pick<SandboxTelegramTransportOptions, 'file'>> &
        SandboxTelegramTransportOptions;
    private readonly log: Pick<Console, 'warn' | 'info' | 'debug' | 'error'>;

    constructor(options: SandboxTelegramTransportOptions) {
        this.opts = { ...options };
        this.log = options.log ?? console;
    }

    private async readLines(): Promise<string[]> {
        try {
            const raw = await readFile(this.opts.file, 'utf8');
            return raw.split('\n').filter((l) => l.trim() !== '');
        } catch {
            return [];
        }
    }

    private async appendLine(line: string): Promise<void> {
        await mkdir(path.dirname(this.opts.file), { recursive: true, mode: 0o700 });
        // Never concatenate onto a non-newline-terminated tail (JSONL
        // hygiene — a partial inbound line must not corrupt outbound).
        let prefix = '';
        try {
            const existing = await readFile(this.opts.file, 'utf8');
            if (existing.length > 0 && !existing.endsWith('\n')) {
                prefix = '\n';
            }
        } catch {
            // File does not exist yet.
        }
        await appendFile(this.opts.file, `${prefix}${line}\n`, { encoding: 'utf8', mode: 0o600 });
    }

    async getUpdates(offset: number): Promise<TelegramUpdate[]> {
        const out: TelegramUpdate[] = [];
        for (const line of await this.readLines()) {
            try {
                const parsed = JSON.parse(line) as TelegramUpdate;
                if (typeof parsed.update_id === 'number' && parsed.update_id > offset) {
                    out.push(parsed);
                }
            } catch {
                // Skip non-JSON lines (comment headers in the evidence file).
            }
        }
        return out;
    }

    async sendMessage(chatId: string, text: string): Promise<{ ok: boolean }> {
        const outbound: TelegramOutbound = {
            ts: (this.opts.now?.() ?? new Date()).toISOString(),
            chat_id: chatId,
            text,
        };
        await this.appendLine(JSON.stringify(outbound));
        this.log.info?.(`[telegram:sandbox] → ${chatId}: ${redactSecrets(text.slice(0, 120))}${text.length > 120 ? '…' : ''}`);
        return { ok: true };
    }

    async close(): Promise<void> {
        // The file is the evidence log; leave it in place.
    }
}
