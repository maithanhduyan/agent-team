/**
 * Two-way Redmine sync.
 *
 * Direction 1 — Redmine -> orchestrator (`importRedmineIssues`, polled):
 *   open issues of the team's Redmine project whose subject follows the
 *   convention `[<agent>] <title>` become orchestrator tasks (linked via
 *   tasks.redmine_issue_id). Import is idempotent and never auto-dispatches:
 *   dispatch stays a human/PM/owner decision.
 *
 * Direction 2 — orchestrator -> Redmine (`updateRedmineOnResult`, called
 *   from the run-result route): when a linked task finishes, the issue is
 *   closed (succeeded) or rejected (failed) with a note carrying the result
 *   summary, branch and PR URL.
 *
 * Every call is fail-open: Redmine being down must never crash the
 * orchestrator or block task processing.
 */
import type { Config } from './config.js';
import type { Ctx } from './types.js';

const AGENT_IDS = ['pm', 'ba', 'frontend', 'backend', 'tester', 'reviewer', 'cto', 'owner'];

/** Known Redmine ids for the agent-team project's tracker/statuses. */
const TRACKER_TASK_ID = 4; // "Task" tracker (seeded by the PM agent)
const STATUS_OPEN = 1; // "New"
const STATUS_IN_PROGRESS = 2; // "In Progress"
const STATUS_CLOSED = 5; // "Closed"
const STATUS_REJECTED = 6; // "Rejected"

interface RedmineIssue {
    id: number;
    subject: string;
    description: string | null;
    project?: { id: number; name: string };
}

/** Subject convention `[<agent>] <title>` -> { agent, title } or null. */
function parseSubject(subject: string): { agent: string; title: string } | null {
    const match = /^\[([a-z]+)\]\s+(.+)$/i.exec(subject.trim());
    if (!match)
        return null;
    const agent = match[1]!.toLowerCase();
    if (!AGENT_IDS.includes(agent))
        return null;
    return { agent, title: match[2]!.trim() };
}

function redmineFetch(config: Config, path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (config.redmineApiKey)
        headers.set('X-Redmine-API-Key', config.redmineApiKey);
    return fetch(`${config.redmineUrl}${path}`, { ...init, headers });
}

/**
 * Import open Redmine issues as orchestrator tasks. Runs on boot and then
 * on an interval; safe to call concurrently (unique index on
 * redmine_issue_id makes the insert idempotent).
 */
export async function importRedmineIssues(ctx: Ctx): Promise<number> {
    const { config, db } = ctx;
    if (!config.redmineApiKey)
        return 0; // sync disabled
    let response: Response;
    try {
        response = await redmineFetch(
            config,
            `/issues.json?status_id=open&tracker_id=${TRACKER_TASK_ID}&limit=25&sort=id:asc`,
        );
    }
    catch (err) {
        console.warn(`[redmine] list issues failed: ${(err as Error).message}`);
        return 0;
    }
    if (!response.ok) {
        console.warn(`[redmine] list issues HTTP ${response.status}`);
        return 0;
    }
    const body = (await response.json()) as { issues?: RedmineIssue[] };
    const issues = body.issues ?? [];
    if (issues.length === 0)
        return 0;

    const projectRes = await db.query('select id from projects order by id limit 1');
    if (projectRes.rows.length === 0) {
        console.warn('[redmine] no orchestrator project to import issues into');
        return 0;
    }
    const projectId = projectRes.rows[0].id as number;

    let imported = 0;
    for (const issue of issues) {
        const parsed = parseSubject(issue.subject);
        if (!parsed) {
            console.log(`[redmine] skip issue #${issue.id}: subject not in "[<agent>] <title>" form`);
            continue;
        }
        try {
            const { rows } = await db.query(
                `insert into tasks (project_id, title, description, assigned_agent, redmine_issue_id)
                 values ($1, $2, $3, $4, $5)
                 on conflict do nothing
                 returning id`,
                [projectId, `Redmine #${issue.id}: ${parsed.title}`, issue.description ?? '', parsed.agent, issue.id],
            );
            if (rows.length === 0)
                continue; // already imported
            const taskId = rows[0].id as number;
            imported += 1;
            console.log(`[redmine] imported issue #${issue.id} as task ${taskId} (${parsed.agent})`);
            // Mark the issue in progress and record the mapping in a note.
            await redmineFetch(config, `/issues/${issue.id}.json`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ issue: { status_id: STATUS_IN_PROGRESS, notes: `Đã tạo orchestrator task TASK-${String(taskId).padStart(3, '0')}.` } }),
            }).catch((err) => console.warn(`[redmine] mark issue #${issue.id} in progress failed: ${(err as Error).message}`));
        }
        catch (err) {
            console.warn(`[redmine] import issue #${issue.id} failed: ${(err as Error).message}`);
        }
    }
    return imported;
}

/** Update the linked Redmine issue when an orchestrator task finishes. */
export async function updateRedmineOnResult(
    ctx: Ctx,
    task: { id: number; title: string; redmine_issue_id: number | null },
    result: { status: string; summary?: string | null; branch?: string | null; pr_url?: string | null; exit_code?: number | null },
): Promise<void> {
    const { config } = ctx;
    const issueId = task.redmine_issue_id;
    if (!config.redmineApiKey || issueId === null)
        return;
    const succeeded = result.status === 'succeeded';
    const lines = [
        `**Kết quả orchestrator TASK-${String(task.id).padStart(3, '0')}:** ${succeeded ? '✅ thành công' : '❌ thất bại'}`,
    ];
    if (result.summary)
        lines.push(`- Summary: ${result.summary}`);
    if (result.branch)
        lines.push(`- Branch: ${result.branch}`);
    if (result.pr_url)
        lines.push(`- PR: ${result.pr_url}`);
    if (result.exit_code !== null && result.exit_code !== undefined)
        lines.push(`- Exit code: ${result.exit_code}`);
    try {
        const response = await redmineFetch(config, `/issues/${issueId}.json`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                issue: {
                    status_id: succeeded ? STATUS_CLOSED : STATUS_REJECTED,
                    notes: lines.join('\n'),
                },
            }),
        });
        if (!response.ok)
            console.warn(`[redmine] update issue #${issueId} HTTP ${response.status}`);
        else
            console.log(`[redmine] issue #${issueId} -> ${succeeded ? 'Closed' : 'Rejected'} (task ${task.id})`);
    }
    catch (err) {
        console.warn(`[redmine] update issue #${issueId} failed: ${(err as Error).message}`);
    }
}
