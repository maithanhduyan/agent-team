#!/usr/bin/env node
// Real-HTTP smoke test for the backend service.
//
// Builds must exist first (`pnpm build`): this script boots the compiled
// server on an ephemeral local port, performs a real GET /healthz over
// HTTP, verifies the JSON body { ok: true }, then checks graceful
// shutdown. Exits 0 on success, 1 on failure.
import { spawn } from 'node:child_process';
import net from 'node:net';

const HOST = '127.0.0.1';
const READY_TIMEOUT_MS = 10_000;
const EXIT_TIMEOUT_MS = 5_000;

function getFreePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, HOST, () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

async function waitForHealth(baseUrl, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${baseUrl}/healthz`);
            if (res.ok) return res;
            lastError = new Error(`/healthz answered ${res.status}`);
        }
        catch (err) {
            lastError = err; // connection refused until the server is up
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw lastError ?? new Error(`timed out after ${timeoutMs}ms waiting for /healthz`);
}

function waitForExit(child, timeoutMs) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ code: null, signal: 'timeout' }), timeoutMs);
        child.once('exit', (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal });
        });
    });
}

const port = await getFreePort();
const baseUrl = `http://${HOST}:${port}`;

const child = spawn(process.execPath, ['dist/server.js'], {
    env: { ...process.env, BACKEND_PORT: String(port), HOST, LOG_LEVEL: 'silent' },
    stdio: ['ignore', 'pipe', 'pipe'],
});

let childLog = '';
child.stdout.on('data', (chunk) => { childLog += chunk; });
child.stderr.on('data', (chunk) => { childLog += chunk; });

let failed = false;
try {
    console.log(`smoke: booting server on ${baseUrl} ...`);
    const res = await waitForHealth(baseUrl, READY_TIMEOUT_MS);
    const body = await res.json();

    const statusOk = res.status === 200;
    const bodyOk = JSON.stringify(body) === JSON.stringify({ ok: true });
    const typeOk = /^application\/json/.test(String(res.headers.get('content-type') ?? ''));

    if (!statusOk || !bodyOk || !typeOk) {
        throw new Error(
            `unexpected /healthz response: status=${res.status} body=${JSON.stringify(body)} ` +
            `content-type=${res.headers.get('content-type')}`,
        );
    }
    console.log(`smoke: PASS GET /healthz -> 200 ${JSON.stringify(body)} (application/json)`);

    // Graceful shutdown: SIGTERM should make the server exit cleanly.
    child.kill('SIGTERM');
    const { code, signal } = await waitForExit(child, EXIT_TIMEOUT_MS);
    if (code !== 0 || signal !== null) {
        throw new Error(`server did not shut down cleanly: code=${code} signal=${signal}`);
    }
    console.log('smoke: PASS graceful shutdown on SIGTERM (exit 0)');
    console.log('smoke: OK');
}
catch (err) {
    failed = true;
    console.error(`smoke: FAIL — ${err.message}`);
    if (childLog.trim()) {
        console.error('--- server log ---');
        console.error(childLog.trim());
        console.error('-------------------');
    }
}
finally {
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
    }
    process.exit(failed ? 1 : 0);
}
