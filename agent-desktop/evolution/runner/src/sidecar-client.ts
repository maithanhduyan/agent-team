/**
 * Python sidecar client — spawns the GEPA sidecar per run and speaks
 * JSON-RPC 2.0 over stdio (T09 §4.2/§4.3, ADR-009 §6).
 *
 * The Node/TS runner is the trust anchor: it owns the keys, the git,
 * the guardrails and the audit trail. The sidecar is a compute worker
 * that only ever receives the data whitelist (dataset JSON, base skill
 * text, env-less config, job id, scratch dir) and only ever emits
 * candidate texts + metadata. Request/response only — the sidecar
 * never initiates actions (ADR-009 §6.3.1).
 *
 * Lifecycle: spawn → initialize → evolve (streamed `candidate`
 * notifications) → finalize result → close. A hung sidecar is killed
 * after `timeoutMs` and the run fails closed (ADR-009 §6.3.4).
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { Readable, Writable } from 'node:stream';
import type { CandidateNotification, EvolutionReport } from './types.js';

export interface SidecarClientOptions {
    python: string;
    sidecarDir: string;
    jobId: string;
    scratchDir: string;
    timeoutMs?: number;
    /** Interpreter args (e.g. `["-u", "-m", "gepa_sidecar"]`). */
    moduleArgs?: string[];
}

export interface InitializeParams {
    job_id: string;
    /** Dataset JSON text (raw file bytes — the sha256 is of this text). */
    dataset_raw: string;
    dataset_sha256: string;
    base_skill_text: string;
    base_skill_sha256: string;
    config: Record<string, unknown>;
    sidecar_version: string;
    /** Short-lived, read-only proxy token (ADR-009 §6.3.2) — sent
     * only to the sidecar, never logged/serialized (SEC-KEY-02). */
    lm_proxy_token?: string;
}

export class SidecarClient {
    private readonly opts: Required<Pick<SidecarClientOptions, 'timeoutMs'>> & SidecarClientOptions;
    private proc: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
    private rl: Interface | null = null;
    private pending = new Map<string | number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    private nextId = 1;
    private onCandidate: ((c: CandidateNotification) => void) | null = null;
    private onProgress: ((p: { job_id: string; generation: number; population_best: number | null }) => void) | null = null;
    private stderrBuf = '';

    constructor(opts: SidecarClientOptions) {
        this.opts = { timeoutMs: 600_000, ...opts };
    }

    /** Spawn the sidecar subprocess and start the line reader. */
    async start(): Promise<void> {
        const { python, sidecarDir, jobId, moduleArgs } = this.opts;
        const args = moduleArgs ?? ['-u', '-m', 'gepa_sidecar', '--job', jobId, '--scratch', this.opts.scratchDir];
        this.proc = spawn(python, args, {
            cwd: sidecarDir,
            env: { ...process.env, PYTHONPATH: sidecarDir, PYTHONUNBUFFERED: '1' },
            stdio: ['pipe', 'pipe', 'pipe'],
        }) as ChildProcessByStdio<Writable, Readable, Readable>;

        this.proc.stderr.on('data', (d: Buffer) => {
            this.stderrBuf += d.toString('utf8');
            if (this.stderrBuf.length > 4096) this.stderrBuf = this.stderrBuf.slice(-2048);
        });
        this.proc.on('exit', (code, signal) => {
            this.rejectAllPending(`sidecar exited (code=${code}, signal=${signal})`);
        });

        this.rl = createInterface({ input: this.proc.stdout });
        this.rl.on('line', (line) => this.handleLine(line));
    }

    /** Initialize handshake (dataset + base skill sha256 validated sidecar-side). */
    initialize(params: InitializeParams): Promise<{ ready: boolean; sidecar_version: string; config_warnings: string[] }> {
        return this.request('initialize', params as unknown as Record<string, unknown>) as Promise<{
            ready: boolean;
            sidecar_version: string;
            config_warnings: string[];
        }>;
    }

    /** Run the evolution loop; streams `candidate` notifications. */
    evolve(
        onCandidate: (c: CandidateNotification) => void,
        onProgress?: (p: { job_id: string; generation: number; population_best: number | null }) => void,
    ): Promise<EvolutionReport> {
        this.onCandidate = onCandidate;
        this.onProgress = onProgress ?? null;
        return this.request('evolve', {}) as Promise<EvolutionReport>;
    }

    /** Cooperative cancel between generations (Node may also SIGKILL). */
    cancel(): Promise<{ ok: boolean }> {
        return this.request('cancel', {}) as Promise<{ ok: boolean }>;
    }

    /** Close stdin (EOF) and reap the process. */
    async close(): Promise<void> {
        this.rl?.close();
        this.proc?.stdin.end();
        if (this.proc && this.proc.exitCode === null) {
            await new Promise<void>((resolve) => {
                const t = setTimeout(resolve, 1500);
                this.proc!.once('exit', () => { clearTimeout(t); resolve(); });
            });
        }
    }

    /** Hard kill (hung sidecar — ADR-009 §6.3.4, fail closed). */
    kill(): void {
        this.proc?.kill('SIGKILL');
    }

    /** Captured (redacted-tail) stderr for diagnostics — never secrets. */
    stderrTail(): string {
        return this.stderrBuf.trim().slice(-2048);
    }

    // -- internals -----------------------------------------------------
    private request(method: string, params: Record<string, unknown>): Promise<unknown> {
        if (!this.proc || !this.rl) {
            return Promise.reject(new Error('sidecar client not started'));
        }
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`sidecar request "${method}" timed out after ${this.opts.timeoutMs}ms`));
            }, this.opts.timeoutMs);
            this.pending.set(id, {
                resolve: (v) => { clearTimeout(timer); resolve(v); },
                reject: (e) => { clearTimeout(timer); reject(e); },
            });
            this.proc!.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });
    }

    private handleLine(line: string) {
        if (!line.trim()) return;
        let msg: Record<string, unknown>;
        try {
            msg = JSON.parse(line) as Record<string, unknown>;
        } catch {
            return; // ignore non-JSON diagnostics on stdout
        }
        if (msg.method === 'candidate') {
            this.onCandidate?.(msg.params as CandidateNotification);
            return;
        }
        if (msg.method === 'progress') {
            this.onProgress?.(msg.params as { job_id: string; generation: number; population_best: number | null });
            return;
        }
        const id = msg.id as string | number;
        if (this.pending.has(id)) {
            const p = this.pending.get(id)!;
            this.pending.delete(id);
            if (msg.error) {
                const err = new Error(`sidecar error ${(msg.error as { code?: number }).code ?? ''}: ${(msg.error as { message?: string }).message ?? 'unknown'}`);
                p.reject(err);
            } else {
                p.resolve(msg.result);
            }
        }
    }

    private rejectAllPending(reason: string) {
        for (const p of this.pending.values()) p.reject(new Error(reason));
        this.pending.clear();
    }
}
