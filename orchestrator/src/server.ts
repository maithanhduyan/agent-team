import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createRedis } from './redis.js';
import agentsRoutes from './agents.js';
import tasksRoutes, { dispatchTask } from './tasks.js';
import eventsRoutes from './events.js';
import { importRedmineIssues } from './redmine.js';
import type { Ctx } from './types.js';

const config = loadConfig();
const db = createDb(config);
const redis = createRedis(config);
const ctx: Ctx = { config, db, redis };

const app = Fastify({
    logger: { level: 'info' },
    // Generous: GET /agents/:id/next waits up to ~10s for a run.
    requestTimeout: 60_000,
});

app.get('/healthz', async () => {
    await db.query('select 1');
    return { ok: true };
});

// ------------------------------------------------------------- API auth
// When API_KEY is set (distributed mode: agents and dashboards reach
// the orchestrator over a shared network / the internet), every /api/*
// call must carry it in the `x-api-key` header. Local single-machine
// mode keeps API_KEY empty and auth disabled.
if (config.apiKey) {
    app.addHook('onRequest', async (request, reply) => {
        const path = request.url.split('?')[0]!;
        if (path === '/healthz')
            return; // healthchecks (docker, traefik) stay unauthenticated
        if (request.headers['x-api-key'] !== config.apiKey)
            return reply.code(401).send({ error: 'invalid or missing x-api-key' });
    });
    app.log.info('[auth] API key required for /api/*');
}

app.register(agentsRoutes, { prefix: '/api', ctx });
app.register(tasksRoutes, { prefix: '/api', ctx });
app.register(eventsRoutes, { prefix: '/api', ctx });

async function shutdown(signal: string) {
    app.log.info(`${signal} received, shutting down`);
    try {
        await app.close();
    }
    finally {
        redis.disconnect();
        await db.end();
        process.exit(0);
    }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    // Two-way Redmine sync poller (fail-open; disabled when no API key).
    // Imports open Redmine issues as tasks; result updates are handled in
    // the run-result route.
    if (config.redmineApiKey) {
        // First pass dispatches the backlog too: previously imported
        // Redmine tasks still sitting in `todo` (e.g. created while
        // auto-dispatch was off) start immediately.
        void syncRedmine(true).catch((err) => app.log.warn(`[redmine] initial import failed: ${(err as Error).message}`));
        setInterval(() => {
            void syncRedmine(false).catch((err) => app.log.warn(`[redmine] poll failed: ${(err as Error).message}`));
        }, 30_000);
    }
    else {
        app.log.info('[redmine] sync disabled (no REDMINE_API_KEY)');
    }
}
catch (err) {
    app.log.error(err);
    process.exit(1);
}

/** Import open Redmine issues and auto-dispatch them (when enabled). */
async function syncRedmine(includeBacklog: boolean) {
    const imported = await importRedmineIssues(ctx);
    if (!config.redmineAutoDispatch) {
        if (imported.length > 0)
            app.log.info(`[redmine] imported ${imported.length} task(s); auto-dispatch disabled, left in todo`);
        return;
    }
    const ids = new Set(imported);
    if (includeBacklog) {
        const { rows } = await db.query(
            `select id from tasks where status = 'todo' and redmine_issue_id is not null and assigned_agent is not null`,
        );
        for (const row of rows)
            ids.add(row.id as number);
    }
    for (const id of ids) {
        try {
            const run = await dispatchTask(ctx, id);
            app.log.info(`[redmine] auto-dispatched task ${id} (run ${run.id})`);
        }
        catch (err) {
            app.log.warn(`[redmine] auto-dispatch of task ${id} failed: ${(err as Error).message}`);
        }
    }
}
