import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createRedis } from './redis.js';
import agentsRoutes from './agents.js';
import tasksRoutes from './tasks.js';
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
        void importRedmineIssues(ctx).catch((err) => app.log.warn(`[redmine] initial import failed: ${(err as Error).message}`));
        setInterval(() => {
            void importRedmineIssues(ctx).catch((err) => app.log.warn(`[redmine] poll failed: ${(err as Error).message}`));
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
