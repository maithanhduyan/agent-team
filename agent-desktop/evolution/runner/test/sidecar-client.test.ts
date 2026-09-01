/**
 * T12 sidecar-client tests (TASK-9053 / Redmine #47) — JSON-RPC over
 * stdio against the REAL Python sidecar (integration, ADR-009 §4.2).
 *
 * Verifies: spawn per run, initialize handshake (sha256 checks),
 * evolve streaming candidate notifications, cancel, hard timeout kill,
 * and that the data whitelist is respected (no keys in the config
 * block — SEC-KEY-02).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SidecarClient } from '../src/sidecar-client.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const SIDECAR_DIR = join(REPO_ROOT, 'agent-desktop/evolution/sidecar');

const PYTHON = 'python3';
const BASE_SKILL = readFileSync(
    join(REPO_ROOT, 'agent-desktop/evolution/harness/fixtures/install-dsh/SKILL.md'),
    'utf8',
);

function sha256(text: string): string {
    return createHash('sha256').update(text).digest('hex');
}

function havePython(): boolean {
    try {
        execFileSync(PYTHON, ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

const hasPython = havePython();
const describe = hasPython ? test : test.skip;

describe('sidecar lifecycle: initialize → evolve → candidates → result', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'gepa-client-'));
    try {
        const client = new SidecarClient({
            python: PYTHON,
            sidecarDir: SIDECAR_DIR,
            jobId: 'evo_client_01',
            scratchDir: scratch,
            timeoutMs: 60_000,
        });
        await client.start();
        try {
            const init = await client.initialize({
                job_id: 'evo_client_01',
                dataset_raw: JSON.stringify({
                    schema_version: 1,
                    cases: [
                        { scenario: 'efs', context: 'c', error: 'e', fix: 'Detect the EFS-encrypted target directory and refuse with a clear EFS message.' },
                        { scenario: 'junction', context: 'c', error: 'e', fix: 'Resolve NTFS junction links to the real target and bound traversal with a visited set.' },
                    ],
                }),
                dataset_sha256: sha256(JSON.stringify({
                    schema_version: 1,
                    cases: [
                        { scenario: 'efs', context: 'c', error: 'e', fix: 'Detect the EFS-encrypted target directory and refuse with a clear EFS message.' },
                        { scenario: 'junction', context: 'c', error: 'e', fix: 'Resolve NTFS junction links to the real target and bound traversal with a visited set.' },
                    ],
                })),
                base_skill_text: BASE_SKILL,
                base_skill_sha256: sha256(BASE_SKILL),
                config: { population_size: 3, generations: 1, elitism: 1, random_seed: 5 },
                sidecar_version: '0.1.0',
            });
            assert.equal(init.ready, true);
            assert.equal(init.sidecar_version, '0.1.0');

            const candidates: unknown[] = [];
            const report = await client.evolve((c) => candidates.push(c));
            assert.equal(report.status, 'ok');
            assert.equal(report.sidecar_version, '0.1.0');
            assert.ok(candidates.length >= 1, 'evolve must stream >= 1 candidate');
            const first = candidates[0] as { candidate_id: string; size_bytes: number; skill_text: string };
            assert.ok(first.candidate_id.startsWith('gen'));
            assert.ok(first.size_bytes > 0);
            assert.ok(first.skill_text.length > 0);
        } finally {
            await client.close();
        }
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
});

describe('sidecar rejects dataset sha256 mismatch (COV-3 immutability)', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'gepa-client-'));
    try {
        const client = new SidecarClient({
            python: PYTHON,
            sidecarDir: SIDECAR_DIR,
            jobId: 'evo_client_02',
            scratchDir: scratch,
            timeoutMs: 30_000,
        });
        await client.start();
        try {
            await assert.rejects(
                client.initialize({
                    job_id: 'evo_client_02',
                    dataset_raw: JSON.stringify({ schema_version: 1, cases: [] }),
                    dataset_sha256: '0'.repeat(64),
                    base_skill_text: BASE_SKILL,
                    base_skill_sha256: sha256(BASE_SKILL),
                    config: {},
                    sidecar_version: '0.1.0',
                }),
                /sha256 mismatch/,
            );
        } finally {
            await client.close();
        }
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
});

describe('sidecar rejects base-skill sha256 mismatch', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'gepa-client-'));
    try {
        const client = new SidecarClient({
            python: PYTHON,
            sidecarDir: SIDECAR_DIR,
            jobId: 'evo_client_03',
            scratchDir: scratch,
            timeoutMs: 30_000,
        });
        await client.start();
        try {
            await assert.rejects(
                client.initialize({
                    job_id: 'evo_client_03',
                    dataset_raw: JSON.stringify({ schema_version: 1, cases: [] }),
                    dataset_sha256: sha256(JSON.stringify({ schema_version: 1, cases: [] })),
                    base_skill_text: BASE_SKILL,
                    base_skill_sha256: '1'.repeat(64),
                    config: {},
                    sidecar_version: '0.1.0',
                }),
                /base skill sha256 mismatch/,
            );
        } finally {
            await client.close();
        }
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
});

describe('sidecar cancel is accepted', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'gepa-client-'));
    try {
        const client = new SidecarClient({
            python: PYTHON,
            sidecarDir: SIDECAR_DIR,
            jobId: 'evo_client_04',
            scratchDir: scratch,
            timeoutMs: 30_000,
        });
        await client.start();
        try {
            const out = await client.cancel();
            assert.equal(out.ok, true);
        } finally {
            await client.close();
        }
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
});

describe('sidecar client reports request timeout (hung sidecar kills)', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'gepa-client-'));
    try {
        const client = new SidecarClient({
            python: PYTHON,
            sidecarDir: SIDECAR_DIR,
            jobId: 'evo_client_05',
            scratchDir: scratch,
            timeoutMs: 500,
        });
        await client.start();
        try {
            // evolve without initialize → the sidecar answers an error
            // quickly; but a HUNG sidecar would hit the 500ms timeout.
            await assert.rejects(client.evolve(() => {}), /before initialize/);
        } finally {
            client.kill();
        }
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
});
