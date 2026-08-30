/**
 * Demo seed: creates one project, a small dependent task graph,
 * and dispatches the first task. Run inside the orchestrator
 * container after `make up`:
 *
 *   docker compose exec orchestrator node dist/seed.js
 *
 * The task graph (T1 = backend skeleton):
 *   T1 backend  -> T2 frontend shell
 *                -> T3 tester test plan
 *                -> T4 reviewer (waits for T2 as well)
 *                -> T5 BA user stories
 *                -> T6 CTO architecture review
 * When the backend finishes T1, the orchestrator automatically
 * dispatches the unblocked dependents.
 */
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createRedis } from './redis.js';
import { dispatchTask } from './tasks.js';

async function main() {
    const config = loadConfig();
    const db = createDb(config);
    const redis = createRedis(config);

    const projectName = process.env.SEED_PROJECT ?? 'demo-project';
    const repoUrl = process.env.SEED_REPOSITORY_URL ?? null;
    const defaultBranch = process.env.SEED_DEFAULT_BRANCH ?? 'main';

    const existing = await db.query('select id from projects where name = $1', [
        projectName,
    ]);
    let projectId: number;
    if (existing.rows.length > 0) {
        projectId = existing.rows[0].id;
        // Re-running the seed with a SEED_REPOSITORY_URL must not be a
        // silent no-op: update the URL so a previously URL-less project
        // picks up the remote (agents push branches/PRs only when a
        // repository_url is configured).
        if (repoUrl) {
            await db.query('update projects set repository_url = $2, default_branch = $3, updated_at = now() where id = $1', [
                projectId,
                repoUrl,
                defaultBranch,
            ]);
            console.log(`[seed] updated repository_url for project "${projectName}" (id=${projectId})`);
        }
        console.log(`[seed] project "${projectName}" already exists (id=${projectId})`);
    }
    else {
        const { rows } = await db.query(`insert into projects (name, repository_url, default_branch)
       values ($1, $2, $3) returning id`, [projectName, repoUrl, defaultBranch]);
        projectId = rows[0].id;
        console.log(`[seed] created project "${projectName}" (id=${projectId})`);
    }

    const createdIds: number[] = [];
    async function createTask(title: string, description: string, agent: string, dependsOn: number[] = []) {
        const { rows } = await db.query(`insert into tasks (project_id, title, description, assigned_agent)
       values ($1, $2, $3, $4) returning id`, [projectId, title, description, agent]);
        const id = rows[0].id;
        for (const dep of dependsOn) {
            await db.query(`insert into task_dependencies (task_id, depends_on_task_id) values ($1, $2)`, [id, dep]);
        }
        createdIds.push(id);
        console.log(`[seed] task ${id} (${agent}): ${title}`);
        return id;
    }

    const t1 = await createTask('Backend: service skeleton with health endpoint', 'Scaffold the backend service in this workspace. Add a /healthz endpoint returning JSON {ok: true} and a smoke test proving it works. Follow AGENTS.md.', 'backend');
    await createTask('Frontend: app shell with routing', 'Scaffold the frontend app shell with routing and a placeholder home page. Follow AGENTS.md.', 'frontend', [t1]);
    await createTask('QA: test plan for the skeleton', 'Write a test plan covering the backend /healthz endpoint and the frontend shell. Follow AGENTS.md.', 'tester', [t1]);
    await createTask('Review: review the skeleton PRs', 'Review the backend and frontend skeleton PRs once both exist. Verdict must be APPROVE or REQUEST CHANGES with specifics. Follow AGENTS.md.', 'reviewer', [t1]);
    await createTask('BA: user stories and acceptance criteria for the skeleton', 'Write user stories ("As a ..., I want ..., so that ...") with measurable acceptance criteria covering the backend /healthz endpoint and the frontend shell. Update REQUIREMENTS.md. Follow AGENTS.md.', 'ba', [t1]);
    await createTask('CTO: architecture review of the skeleton', 'Review the skeleton architecture (tech stack, module boundaries, contracts) against ARCHITECTURE.md and DECISIONS.md. Verdict must be APPROVE or REQUEST CHANGES with specifics. Follow AGENTS.md.', 'cto', [t1]);

    console.log('[seed] dispatching first task to backend...');
    const run = await dispatchTask({ config, db, redis }, createdIds[0]);
    if (!run)
        throw new Error('dispatch returned no run');
    console.log(`[seed] dispatched run ${run.id} for task ${createdIds[0]}`);
    console.log('[seed] watch: docker compose logs -f dsh-backend dsh-frontend dsh-tester dsh-reviewer dsh-ba dsh-cto');

    await db.end();
    redis.disconnect();
}

main().catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
});
