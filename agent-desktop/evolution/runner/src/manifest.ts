/**
 * Run manifest — SEC-GEPA-11 audit trail (T12, T10 §6.3).
 *
 * Written to `runs/<job_id>/manifest.json` after every run (success or
 * failure): dataset hash, sidecar version, config, per-generation
 * candidates + guardrail outcomes + judge verdicts + fitness + final
 * verdict + PR link. Replayable by T15/T19: given the record (dataset
 * hash + harness version + candidate) fitness and guardrail outcomes
 * can be re-derived without the original environment (AT-2).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { computeSha256 } from '../../src/dataset.js';
import type { GuardrailResult } from './types.js';

export interface ManifestCandidate {
    candidate_id: string;
    generation: number;
    size_bytes: number;
    self_fitness: number | null;
    self_guardrails: Record<string, unknown> | null;
    reflection: { context: string; error: string; fix: string } | null;
    /** Path of the persisted candidate SKILL.md (T13 integration, AT-2). */
    skill_path: string | null;
    guardrails: Record<string, GuardrailResult>;
    fitness: {
        fitness: number;
        threshold_met: boolean;
        passed: number;
        total: number;
        failures: unknown[];
        regression: { pass: boolean; regressions: unknown[] };
    };
    judge: {
        gate: string;
        per_model: Record<string, string>;
        verdicts: Record<string, unknown>;
        disabled_models: string[];
        skipped_models: string[];
        reason: string | null;
    };
    candidate_verdict: 'accepted' | 'rejected';
    reject_reasons: string[];
}

export interface RunManifest {
    manifest_version: '1.0';
    schema_version: 1;
    run_id: string;
    job_id: string;
    skill: string;
    dataset: { dataset_id: string; sha256: string; case_count: number; path: string };
    base_skill: { path: string; sha256: string; size_bytes: number };
    sidecar: { version: string; mode: 'subprocess' | 'container'; deps_pinned: boolean; sandbox_image: string | null; python: string | null };
    config: Record<string, unknown>;
    started_at: string;
    ended_at: string;
    status: 'completed' | 'failed' | 'paused';
    verdict: 'merge-ready' | 'rejected' | 'paused' | 'no-candidate';
    generations_run: number;
    best_candidate_id: string | null;
    candidates: ManifestCandidate[];
    guardrails: Record<string, GuardrailResult>;
    judge_cost: { month: string; providers: Record<string, { spentUsd: number; capUsd: number; disabled: boolean }> };
    pr: { branch: string | null; url: string | null; note: string };
    error?: { message: string } | null;
}

export interface ManifestBuildInput {
    jobId: string;
    skill: string;
    dataset: { dataset_id: string; sha256: string; case_count: number; path: string };
    baseSkill: { path: string; sha256: string; size_bytes: number };
    sidecar: { version: string; mode: 'subprocess' | 'container'; deps_pinned: boolean; sandbox_image: string | null; python: string | null };
    config: Record<string, unknown>;
    startedAt: string;
    endedAt: string;
    status: 'completed' | 'failed' | 'paused';
    verdict: 'merge-ready' | 'rejected' | 'paused' | 'no-candidate';
    generationsRun: number;
    bestCandidateId: string | null;
    candidates: ManifestCandidate[];
    runGuardrails: Record<string, GuardrailResult>;
    judgeCost: { month: string; providers: Record<string, { spentUsd: number; capUsd: number; disabled: boolean }> };
    pr: { branch: string | null; url: string | null; note: string };
    error?: { message: string } | null;
}

export function buildManifest(input: ManifestBuildInput): RunManifest {
    return {
        manifest_version: '1.0',
        schema_version: 1,
        run_id: input.jobId,
        job_id: input.jobId,
        skill: input.skill,
        dataset: input.dataset,
        base_skill: input.baseSkill,
        sidecar: input.sidecar,
        config: input.config,
        started_at: input.startedAt,
        ended_at: input.endedAt,
        status: input.status,
        verdict: input.verdict,
        generations_run: input.generationsRun,
        best_candidate_id: input.bestCandidateId,
        candidates: input.candidates,
        guardrails: input.runGuardrails,
        judge_cost: input.judgeCost,
        pr: input.pr,
        error: input.error ?? null,
    };
}

/** Write the manifest to `runs/<job_id>/manifest.json` (0600 perms). */
export function writeManifest(manifest: RunManifest, runsDir: string): string {
    const file = join(runsDir, `${manifest.job_id}`, 'manifest.json');
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    return file;
}

/**
 * Persist a candidate SKILL.md under `runs/<job_id>/candidates/<candidate_id>/`
 * (0600 perms) — **T13 integration** (T10 §6.3 AT-2, SEC-GEPA-11).
 *
 * The run record is replayable only when it carries the candidate text:
 * given `{dataset hash, harness version, candidate}` T15/T19 can re-derive
 * fitness without the original environment. The T13 PR workflow consumes
 * this file (`skill_path`) to build the candidate branch.
 */
export function writeCandidateSkill(runsDir: string, jobId: string, candidateId: string, skillText: string): string {
    const dir = join(runsDir, jobId, 'candidates', candidateId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, 'SKILL.md');
    writeFileSync(file, skillText, { encoding: 'utf8', mode: 0o600 });
    return file;
}

/** Dataset sha256 helper (T11 `computeSha256` re-export). */
export { computeSha256 };
