/**
 * Minimal GitHub REST client for the T13 PR workflow.
 *
 * Used ONLY to: open the candidate PR, read PR reviews (approvals,
 * SEC-GEPA-06), and read the PR body (metadata auto-flag, BR-3). There
 * is deliberately NO merge endpoint here — no `POST /pulls/{n}/merge`,
 * no auto-merge (SEC-GEPA-07). Merge is a manual human action.
 *
 * `dryRun` mode records calls and returns synthetic values so tests and
 * `plan` runs never touch the network.
 */

import type { PullRequestReview } from './review.js';

export interface PullRequestInfo {
    number: number;
    html_url: string;
    title: string;
    state: string;
    body: string;
}

export interface GitHubClient {
    openPullRequest(opts: { owner: string; repo: string; head: string; base: string; title: string; body: string }): Promise<PullRequestInfo>;
    getPullRequest(opts: { owner: string; repo: string; number: number }): Promise<PullRequestInfo>;
    getPullRequestReviews(opts: { owner: string; repo: string; number: number }): Promise<PullRequestReview[]>;
    /** Recorded calls (useful for dry-run assertions). */
    calls: Array<{ method: string; url: string; body?: unknown }>;
}

export interface CreateGitHubClientOpts {
    token: string | null;
    dryRun: boolean;
    fetchImpl?: typeof fetch;
}

export function createGitHubClient(opts: CreateGitHubClientOpts): GitHubClient {
    const { token, dryRun } = opts;
    const fetchImpl = opts.fetchImpl ?? fetch;
    const calls: GitHubClient['calls'] = [];

    async function apiRaw<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
        if (dryRun) {
            return null as unknown as T; // dry-run: caller handles nulls
        }
        if (!token) {
            throw new Error(`GITHUB_TOKEN is required for ${method} ${url} (set it or use --dry-run / plan)`);
        }
        const res = await fetchImpl(url, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`GitHub API ${method} ${url} → ${res.status}: ${text.slice(0, 500)}`);
        }
        return (await res.json()) as T;
    }

    return {
        calls,
        async openPullRequest(opts) {
            const { owner, repo, head, base, title, body } = opts;
            calls.push({
                method: 'POST',
                url: `https://api.github.com/repos/${owner}/${repo}/pulls`,
                body: { title, head, base },
            });
            if (dryRun) {
                return {
                    number: 0,
                    html_url: `dry-run: would create PR ${owner}/${repo} ${head} → ${base}`,
                    title,
                    state: 'open',
                    body,
                };
            }
            return apiRaw<{
                number: number;
                html_url: string;
                title: string;
                state: string;
                body: string;
            }>('POST', `https://api.github.com/repos/${owner}/${repo}/pulls`, {
                title,
                head,
                base,
                body,
                maintainer_can_modify: false,
            });
        },
        async getPullRequest(opts) {
            const { owner, repo, number } = opts;
            calls.push({ method: 'GET', url: `https://api.github.com/repos/${owner}/${repo}/pulls/${number}` });
            if (dryRun) {
                throw new Error('dry-run: getPullRequest is not supported (no network)');
            }
            return apiRaw<{
                number: number;
                html_url: string;
                title: string;
                state: string;
                body: string;
            }>('GET', `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`);
        },
        async getPullRequestReviews(opts) {
            const { owner, repo, number } = opts;
            calls.push({ method: 'GET', url: `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/reviews` });
            if (dryRun) {
                return [];
            }
            const reviews = await apiRaw<
                Array<{
                    user: { login: string } | null;
                    state: string;
                    submitted_at: string;
                }>
            >('GET', `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/reviews`);
            return reviews
                .filter((r) => r.user)
                .map((r) => ({
                    reviewer: r.user!.login,
                    state: r.state as PullRequestReview['state'],
                    submitted_at: r.submitted_at,
                }));
        },
    };
}
