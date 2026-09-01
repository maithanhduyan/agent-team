/**
 * Human-review gates (T13, SEC-GEPA-06/07, T10 §7.2 R-7/R-8).
 *
 * SEC-GEPA-06 — merge requires **2 explicit approvals — owner AND cto —
 * recorded on the PR**; the workflow refuses merge with fewer than 2
 * (R-7). This module VERIFIES eligibility; it never performs a merge.
 *
 * SEC-GEPA-07 — auto-merge forbidden: no automated merge path anywhere;
 * CI runs checks but never merges; the runner never merges on the
 * agent's behalf; merge is a human action (R-8). `scanForAutoMerge` is a
 * structural review that proves the workflow/CI sources contain no merge
 * action (used by the no-auto-merge review test).
 */

import { readFileSync } from 'node:fs';

export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';

export interface PullRequestReview {
    reviewer: string;
    state: ReviewState;
    submitted_at: string;
}

export interface ApprovalCheckResult {
    id: 'SEC-GEPA-06';
    metric: string;
    threshold: string;
    actual: string;
    pass: boolean;
    granted: string[];
    missing: string[];
    reason: string;
}

/**
 * Check the 2-approval rule (owner AND cto — SEC-GEPA-06, T10 §7.1 D-7).
 * `roleMap` maps each required role to the reviewer login(s) that count.
 */
export function checkApprovals(
    reviews: PullRequestReview[],
    opts: { roleMap: Record<'owner' | 'cto', string[]> },
): ApprovalCheckResult {
    const approved = reviews.filter((r) => r.state === 'APPROVED');
    const granted: string[] = [];
    const missing: string[] = [];

    for (const role of ['owner', 'cto'] as const) {
        const logins = opts.roleMap[role];
        const ok = approved.some((r) => logins.includes(r.reviewer));
        if (ok) granted.push(`${role} (${approved.filter((r) => logins.includes(r.reviewer)).map((r) => r.reviewer).join(',')})`);
        else missing.push(role);
    }

    const pass = missing.length === 0 && granted.length >= 2;
    return {
        id: 'SEC-GEPA-06',
        metric: 'PR approvals (owner + cto) recorded on the PR before merge',
        threshold: '2 explicit approvals — owner AND cto',
        actual: `${approved.length} approval(s): ${approved.map((r) => r.reviewer).join(', ') || 'none'}`,
        pass,
        granted,
        missing,
        reason: pass
            ? 'owner AND cto both approved — merge may proceed ONLY as a manual human action (SEC-GEPA-07)'
            : `fewer than 2 required approvals — missing: ${missing.join(', ')}; merge refused (T10 §7.2 R-7)`,
    };
}

/** Merge-action patterns — a match means an auto-merge path exists (R-8). */
export const AUTO_MERGE_PATTERNS: Array<{ name: string; re: RegExp }> = [
    { name: 'gh-pr-merge', re: /\bgh\s+pr\s+merge\b/i },
    { name: 'api-merge-pr', re: /\/pulls\/\d+\/merge/i },
    { name: 'merge-pr-rest', re: /\bmerge_pull_request\b/i },
    { name: 'enable-auto-merge', re: /\benable_auto_merge\b/i },
    { name: 'auto-merge-flag', re: /["']?auto[-_]merge["']?\s*[:=]\s*(true|1)\b/i },
    { name: 'merge-flag', re: /["']merge["']\s*:\s*true\b/i },
    { name: 'git-merge', re: /\bgit\s+merge\b/ },
    { name: 'gitflow-finish', re: /\bgit\s+flow\s+(feature|bugfix|hotfix|release)\s+finish\b/i },
];

export interface AutoMergeScanResult {
    id: 'SEC-GEPA-07';
    metric: string;
    threshold: string;
    actual: string;
    pass: boolean;
    hits: Array<{ path: string; pattern: string; line: string }>;
}

/** Structural scan: any merge action in the given files ⇒ auto-merge path exists. */
export function scanForAutoMerge(files: Array<{ path: string; content: string }>): AutoMergeScanResult {
    const hits: Array<{ path: string; pattern: string; line: string }> = [];
    for (const f of files) {
        const lines = f.content.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            for (const p of AUTO_MERGE_PATTERNS) {
                if (p.re.test(line)) {
                    hits.push({ path: f.path, pattern: p.name, line: `${i + 1}: ${line.trim()}` });
                }
            }
        }
    }
    return {
        id: 'SEC-GEPA-07',
        metric: 'automated merge events in workflow/CI/runner sources',
        threshold: 0,
        actual: hits.length,
        pass: hits.length === 0,
        hits,
    };
}

/** CLI: `... check-approvals --owner <login> --cto <login> --reviews <json-file>`. */
export function approvalsCli(
    reviewsFile: string,
    opts: { owner: string[]; cto: string[] },
): number {
    const reviews = JSON.parse(readFileSync(reviewsFile, 'utf8')) as PullRequestReview[];
    const r = checkApprovals(reviews, { roleMap: { owner: opts.owner, cto: opts.cto } });
    // eslint-disable-next-line no-console
    console.log(`SEC-GEPA-06 approvals: ${r.pass ? 'PASS (owner + cto)' : 'FAIL'} — ${r.reason}`);
    return r.pass ? 0 : 1;
}
