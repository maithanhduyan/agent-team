/**
 * T13 PR-workflow configuration (agent-desktop/evolution/workflow).
 *
 * Env surface (documented in `.env.example` + `workflow/README.md`):
 *
 *   EVOLUTION_REPO_ROOT      repo root (default: walk up from cwd to the
 *                            directory containing `AGENTS.md`)
 *   EVOLUTION_SKILL_REGISTRY skill registry dir, repo-root-relative
 *                            (default `agents/skills` — T09 §5.1 layout)
 *   PR_REMOTE                git remote (default `origin`)
 *   PR_TARGET_BRANCH         PR base branch (default `develop`)
 *   PR_OWNER / PR_REPO       GitHub owner/repo (default: parsed from the
 *                            git remote URL)
 *   GITHUB_TOKEN             API token for PR creation/reads (no token in
 *                            `--dry-run` / `plan` mode)
 *   PR_APPROVER_OWNER        GitHub login whose APPROVAL counts as the
 *                            "owner" approval (SEC-GEPA-06; default
 *                            `maithanhduyan`)
 *   PR_APPROVER_CTO          GitHub login whose APPROVAL counts as the
 *                            "cto" approval (default `cto`)
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { URL } from 'node:url';

export const DEFAULT_REGISTRY_DIR = 'agents/skills';
export const DEFAULT_TARGET_BRANCH = 'develop';

export interface WorkflowConfig {
    /** Absolute repo root (dir containing AGENTS.md). */
    repoRoot: string;
    /** Skill registry dir, repo-root-relative (T09 §5.1). */
    registryDir: string;
    /** Git remote used for push. */
    remote: string;
    /** PR base branch (the integration branch — never main). */
    targetBranch: string;
    /** GitHub owner (null in plan/dry-run mode). */
    owner: string | null;
    /** GitHub repo (null in plan/dry-run mode). */
    repo: string | null;
    /** GitHub API token (null → dry-run / read-only). */
    token: string | null;
    /** Login whose approval is the "owner" approval (SEC-GEPA-06). */
    approverOwner: string;
    /** Login whose approval is the "cto" approval (SEC-GEPA-06). */
    approverCto: string;
    /** true ⇒ plan only — no git worktree, no push, no API calls. */
    dryRun: boolean;
    /** true ⇒ create branch + commit locally, but do not push / open PR. */
    noPush: boolean;
}

/** Walk up from `start` to the first dir containing `AGENTS.md` (repo root). */
export function resolveRepoRoot(start: string, maxDepth = 6): string {
    let dir = resolve(start);
    for (let i = 0; i < maxDepth; i += 1) {
        if (existsSync(join(dir, 'AGENTS.md'))) return dir;
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error(`cannot locate repo root (AGENTS.md) from ${start}`);
}

/** Parse `owner/repo` out of a git remote URL (https/git/ssh forms,
 * including token-embedded URLs like
 * `https://x-access-token:<token>@github.com/owner/repo.git`). */
export function parseRemoteOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null {
    try {
        const u = new URL(remoteUrl.includes('://') ? remoteUrl : `https://${remoteUrl}`);
        const parts = u.pathname.replace(/^\/+/, '').replace(/\.git$/, '').split('/');
        if (parts.length >= 2 && parts[0] && parts[1]) return { owner: parts[0], repo: parts[1] };
    } catch {
        /* fall through to ssh-form handling */
    }
    // ssh form: git@host:owner/repo.git
    const m = remoteUrl.match(/^[^@]+@[^:]+:(.+)$/);
    if (m) {
        const parts = m[1].replace(/\.git$/, '').split('/');
        if (parts.length >= 2 && parts[0] && parts[1]) return { owner: parts[0], repo: parts[1] };
    }
    return null;
}

export interface LoadWorkflowConfigOpts {
    env: NodeJS.ProcessEnv;
    cwd: string;
    repoRoot?: string;
    remoteUrl?: string | null;
}

export function loadWorkflowConfig(opts: LoadWorkflowConfigOpts): WorkflowConfig {
    const env = opts.env;
    const repoRoot =
        (env.EVOLUTION_REPO_ROOT && resolve(opts.cwd, env.EVOLUTION_REPO_ROOT)) ??
        (opts.repoRoot ? resolve(opts.repoRoot) : resolveRepoRoot(opts.cwd));
    const registryDir = (env.EVOLUTION_SKILL_REGISTRY || DEFAULT_REGISTRY_DIR).trim();

    const owner = env.PR_OWNER?.trim() || null;
    const repo = env.PR_REPO?.trim() || null;
    const remoteUrl = opts.remoteUrl !== undefined ? opts.remoteUrl : null;

    let parsed: { owner: string; repo: string } | null = null;
    if (owner && repo) parsed = { owner, repo };
    else if (remoteUrl) parsed = parseRemoteOwnerRepo(remoteUrl);

    return {
        repoRoot,
        registryDir,
        remote: (env.PR_REMOTE || 'origin').trim(),
        targetBranch: (env.PR_TARGET_BRANCH || DEFAULT_TARGET_BRANCH).trim(),
        owner: parsed?.owner ?? owner,
        repo: parsed?.repo ?? repo,
        token: env.GITHUB_TOKEN?.trim() || null,
        approverOwner: (env.PR_APPROVER_OWNER || 'maithanhduyan').trim(),
        approverCto: (env.PR_APPROVER_CTO || 'cto').trim(),
        dryRun: env.PR_DRY_RUN === '1' || env.PR_DRY_RUN === 'true',
        noPush: env.PR_NO_PUSH === '1' || env.PR_NO_PUSH === 'true',
    };
}
