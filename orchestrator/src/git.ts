import type { Project, Task } from './types.js';

/** "Implement login endpoint" -> "implement-login-endpoint" (truncated). */
export function slugify(value: string, max = 28): string {
    const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return (slug || 'task').slice(0, max);
}

/** 7 -> "TASK-007" */
export function taskKey(taskId: number): string {
    return `TASK-${String(taskId).padStart(3, '0')}`;
}

/** Branch convention: <agent>/TASK-<id>-<slug>, e.g. backend/TASK-007-login. */
export function branchName(agentId: string, task: Task): string {
    return `${agentId}/${taskKey(task.id)}-${slugify(task.title)}`;
}

/**
 * Build the full prompt handed to `dsh --profile headless`.
 * The agent's own AGENTS.md is mounted at the workspace root and
 * carries the role rules; this prompt carries the task itself.
 */
export function buildTaskPrompt(task: Task, project: Project | null, agentId: string): string {
    const lines = [
        `# ${taskKey(task.id)}: ${task.title}`,
        '',
        task.description.trim() || '(no description provided)',
        '',
        '## Project',
        `- name: ${project?.name ?? 'unknown'}`,
        project?.repository_url
            ? `- repository: ${project.repository_url}`
            : '- repository: (not configured)',
        `- default branch: ${project?.default_branch ?? 'main'}`,
        '',
        '## Instructions',
        `- You are the "${agentId}" agent. Read AGENTS.md at the workspace root and follow its rules.`,
        '- Read the project documentation (README.md, ARCHITECTURE.md, REQUIREMENTS.md, DECISIONS.md) before starting.',
        `- Work on branch \`${branchName(agentId, task)}\`; never commit to the default branch.`,
        '- Commit your work in logical steps and push the branch when a remote is configured.',
        project?.repository_url
            ? '- Open a Pull Request for the branch and report its URL in your final summary.'
            : '- No remote is configured; commit locally and report what you changed.',
        '- The task is complete only when the acceptance criteria in the description are met and tests pass.',
    ];
    return lines.join('\n');
}
