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
 * When the backend finishes T1, the orchestrator automatically
 * dispatches T2 and T3; T4 dispatches once T1 and T2 are done.
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

    const existing = await db.query('select id from projects where name = $1', [
        projectName,
    ]);
    let projectId: number;
    if (existing.rows.length > 0) {
        projectId = existing.rows[0].id;
        console.log(`[seed] project "${projectName}" already exists (id=${projectId})`);
    }
    else {
        const { rows } = await db.query(`insert into projects (name, repository_url, default_branch)
       values ($1, $2, 'main') returning id`, [projectName, repoUrl]);
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

    console.log('[seed] dispatching first task to backend...');
    const run = await dispatchTask({ config, db, redis }, createdIds[0]);
    if (!run)
        throw new Error('dispatch returned no run');
    console.log(`[seed] dispatched run ${run.id} for task ${createdIds[0]}`);
    console.log('[seed] watch: docker compose logs -f dsh-backend dsh-frontend dsh-tester dsh-reviewer');

    await db.end();
    redis.disconnect();
}

main().catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
});
