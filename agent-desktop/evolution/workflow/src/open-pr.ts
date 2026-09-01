/**
 * Candidate → branch → PR orchestrator (T13, T10 §6).
 *
 * BR-1: each candidate goes to a DEDICATED branch
 *   `evolution/<skill>/<run-id>-<candidate>`; candidates never commit to
 *   `develop`.
 * BR-2: the branch contains ONLY the candidate SKILL.md + dataset
 *   version reference + run audit record.
 * BR-3/§6.2: the PR body carries the full metadata block — missing
 *   metadata is auto-flagged by `check-metadata` (gate fail).
 *
 * Gates BEFORE a PR is opened (T10 §7.2 — any failure ⇒ REJECT, no PR):
 *   - the run is `completed` with verdict `merge-ready`;
 *   - the candidate's recorded verdict is `accepted`;
 *   - SEC-GEPA-02 (fitness = 100%), SEC-GEPA-03 (size ≤ 15 KB),
 *     SEC-GEPA-04 (0 regressions — recomputed), SEC-GEPA-08 (0 secrets)
 *     all pass;
 *   - the A/B regression is re-run deterministically (CG-1).
 *
 * SEC-GEPA-06/07: this module NEVER merges. It opens the PR and records
 * the PR link back into the run manifest (AT-3); merge is a manual human
 * action after owner + cto approval (verified by `check-approvals`).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { computeSha256 } from '../../src/dataset.js';
import { scanSecrets } from '../../src/secret-scan.js';
import type { RunManifest } from '../../runner/src/manifest.js';
import type { WorkflowConfig } from './config.js';
import { candidateBranchName, buildBranchFileSet, type BranchFile } from './registry.js';
import { checkSizeBytes, SIZE_LIMIT_BYTES } from './size.js';
import { abRegression } from './ab.js';
import { buildPrMetadata, renderPrBody, type PrMetadata } from './metadata.js';
import { checkApprovals } from './review.js';
import type { GitHubClient } from './github.js';

/** Path resolution: absolute paths used as-is; relative → manifest dir. */
export function resolveManifestPath(manifestPath: string, p: string): string {
    return isAbsolute(p) ? p : resolve(dirname(manifestPath), p);
}

/** Load + basic-validate a run manifest (SEC-GEPA-11 record). */
export function loadRunManifest(manifestPath: string): { manifest: RunManifest; ref: string } {
    let raw: string;
    try {
        raw = readFileSync(manifestPath, 'utf8');
    } catch {
        throw new Error(`run manifest not found: ${manifestPath}`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`run manifest is not valid JSON: ${manifestPath}`);
    }
    const m = parsed as RunManifest;
    if (typeof m.run_id !== 'string' || !Array.isArray(m.candidates)) {
        throw new Error(`run manifest is invalid (missing run_id/candidates): ${manifestPath}`);
    }
    return { manifest: m, ref: manifestPath };
}

/** Find a candidate record in the manifest by id. */
export function findCandidate(manifest: RunManifest, candidateId: string): RunManifest['candidates'][number] {
    const c = manifest.candidates.find((x) => x.candidate_id === candidateId);
    if (!c) {
        throw new Error(
            `candidate '${candidateId}' not found in run ${manifest.run_id} ` +
                `(candidates: ${manifest.candidates.map((x) => x.candidate_id).join(', ') || 'none'})`,
        );
    }
    return c;
}

export interface OpenPrInput {
    manifestPath: string;
    candidateId: string;
    /** Candidate SKILL.md text (from --skill file or manifest skill_path). */
    candidateSkillText: string;
    cfg: WorkflowConfig;
    approvals: ReturnType<typeof checkApprovals>;
}

export interface OpenPrPlan {
    branch: string;
    target: string;
    title: string;
    files: BranchFile[];
    metadata: PrMetadata;
    body: string;
    manifestRef: string;
    manifestPath: string;
    candidate: RunManifest['candidates'][number];
    rejectReasons: string[];
}

export interface RejectError extends Error {
    rejectReasons: string[];
}

function reject(reasons: string[]): never {
    const err = new Error(`candidate REJECTED — no PR: ${reasons.join('; ')}`) as RejectError;
    err.rejectReasons = reasons;
    throw err;
}

/**
 * Pure planning: validates all gates and produces the branch file set +
 * metadata + PR body. Throws `RejectError` on any gate failure (R-*).
 */
export function planCandidatePr(input: OpenPrInput): OpenPrPlan {
    const { manifestPath, candidateId, candidateSkillText, cfg, approvals } = input;
    const { manifest, ref } = loadRunManifest(manifestPath);
    const candidate = findCandidate(manifest, candidateId);

    const rejectReasons: string[] = [];

    // Run-level verdict (T10 §7.1 D-1..D-2, R-2).
    if (manifest.status !== 'completed' || manifest.verdict !== 'merge-ready') {
        rejectReasons.push(`run verdict is '${manifest.verdict}' (status=${manifest.status}) — only merge-ready runs open PRs (T10 §7.1)`);
    }

    // Candidate-level verdict (R-3..R-5).
    if (candidate.candidate_verdict !== 'accepted') {
        rejectReasons.push(`candidate verdict is '${candidate.candidate_verdict}' — rejected candidates never reach a PR (T10 §7.2)`);
    }

    // SEC-GEPA-02: fitness must be 100% on the pinned dataset.
    const fitness = candidate.fitness;
    if (!fitness?.threshold_met) {
        rejectReasons.push(`SEC-GEPA-02: fitness ${fitness?.fitness} < 1.0 (R-3)`);
    }

    // SEC-GEPA-03: size re-measured (wc -c equivalent).
    const size = checkSizeBytes(candidate.size_bytes);
    if (!size.pass) rejectReasons.push(`SEC-GEPA-03: size ${size.actual} > ${SIZE_LIMIT_BYTES} (R-5)`);

    // SEC-GEPA-04: A/B regression RECOMPUTED deterministically (CG-1).
    const ab = abRegression(candidateSkillText);
    if (!ab.pass) {
        rejectReasons.push(
            `SEC-GEPA-04: ${ab.regressions.length} regression(s) vs base on the same suite (R-4)`,
        );
    }

    // SEC-GEPA-08: no secrets in the candidate text (recomputed).
    const secretHits = scanSecrets(candidateSkillText);
    if (secretHits.length > 0) rejectReasons.push(`SEC-GEPA-08: ${secretHits.length} secret-scan hit(s) (R-9)`);

    if (rejectReasons.length > 0) reject(rejectReasons);

    const branch = candidateBranchName(manifest.skill, manifest.run_id, candidateId);
    const skillTextSize = Buffer.byteLength(candidateSkillText, 'utf8');
    const candidateSha256 = computeSha256(candidateSkillText);

    // BR-2: branch contains ONLY SKILL.md + dataset ref + audit record.
    const files = buildBranchFileSet({
        registryDir: cfg.registryDir,
        skill: manifest.skill,
        candidateSkillText,
        manifest,
    });

    const metadata = buildPrMetadata({
        manifest,
        candidate,
        candidateSkillText,
        candidateSha256,
        manifestRef: ref,
        branch,
        target: cfg.targetBranch,
    });

    const body = renderPrBody({ metadata, manifestRef: ref, approvals });

    const title = `evolution(${manifest.skill}): candidate ${candidateId} (run ${manifest.run_id}) — v0.5 Skill Evolution`;

    return {
        branch,
        target: cfg.targetBranch,
        title,
        files,
        metadata,
        body,
        manifestRef: ref,
        manifestPath: manifestPath,
        candidate,
        rejectReasons: [],
    };
}

/** Record the PR link back into the run manifest (AT-3: run ↔ PR). */
export function linkManifestToPr(manifestPath: string, link: { branch: string | null; url: string | null; note: string }): void {
    const { manifest } = loadRunManifest(manifestPath);
    manifest.pr = link;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

export interface ExecuteOpenPrResult {
    plan: OpenPrPlan;
    pr: { number: number; html_url: string } | null;
    worktree: string | null;
    pushed: boolean;
}

function runGit(args: string[], opts: { cwd?: string } = {}): string {
    return execFileSync('git', args, {
        cwd: opts.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

/**
 * Execute the plan against git + GitHub.
 *   - dryRun: nothing touches git/network (prints the plan).
 *   - noPush: creates a local branch (worktree) + commit, no push/PR.
 *   - full: worktree → commit → push → open PR → manifest link → cleanup.
 */
export async function executeOpenPr(
    plan: OpenPrPlan,
    cfg: WorkflowConfig,
    client: GitHubClient,
): Promise<ExecuteOpenPrResult> {
    if (cfg.dryRun) {
        // eslint-disable-next-line no-console
        console.log(`[plan] branch: ${plan.branch} (base ${plan.target})`);
        // eslint-disable-next-line no-console
        console.log(`[plan] title: ${plan.title}`);
        for (const f of plan.files) {
            // eslint-disable-next-line no-console
            console.log(`[plan] file: ${f.path} (${Buffer.byteLength(f.content, 'utf8')} bytes)`);
        }
        return { plan, pr: null, worktree: null, pushed: false };
    }

    const worktree = mkdtempSync(join(tmpdir(), 'gepa-pr-'));
    try {
        // Fetch the target branch so we branch from the CURRENT develop.
        runGit(['fetch', cfg.remote, cfg.targetBranch]);
        // BR-1: dedicated branch created from the target branch.
        runGit(['worktree', 'add', '-b', plan.branch, worktree, `${cfg.remote}/${cfg.targetBranch}`]);

        for (const f of plan.files) {
            const abs = join(worktree, f.path);
            mkdirSync(dirname(abs), { recursive: true });
            writeFileSync(abs, f.content, { encoding: 'utf8', mode: 0o600 });
        }
        runGit(['add', '-A'], { cwd: worktree });
        runGit(['commit', '-m', plan.title, '-m', `Branch + PR created by the T13 workflow (SEC-GEPA-06/07: no auto-merge). Run record: ${plan.manifestRef}`], { cwd: worktree });

        if (cfg.noPush) {
            return { plan, pr: null, worktree, pushed: false };
        }

        runGit(['push', '-u', cfg.remote, plan.branch], { cwd: worktree });

        if (!cfg.owner || !cfg.repo) {
            throw new Error('PR_OWNER/PR_REPO (or a git remote URL) is required to open the PR');
        }

        const pr = await client.openPullRequest({
            owner: cfg.owner,
            repo: cfg.repo,
            head: plan.branch,
            base: plan.target,
            title: plan.title,
            body: plan.body,
        });

        // AT-3: run record links to the PR.
        linkManifestToPr(plan.manifestPath, {
            branch: plan.branch,
            url: pr.html_url,
            note: `PR opened by the T13 workflow (SEC-GEPA-06/07: no auto-merge); awaiting owner + cto approval`,
        });

        return { plan, pr: { number: pr.number, html_url: pr.html_url }, worktree, pushed: true };
    } finally {
        if (!cfg.noPush) {
            try {
                runGit(['worktree', 'remove', '--force', worktree]);
            } catch {
                rmSync(worktree, { recursive: true, force: true });
            }
        }
    }
}
