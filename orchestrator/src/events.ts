import type { Ctx, PublishEventInput } from './types.js';

/** Persist an event and fan it out over Redis pub/sub (best effort). */
export async function publishEvent(ctx: Ctx, event: PublishEventInput) {
    const { db, redis } = ctx;
    const { rows } = await db.query(`insert into events (type, agent_id, task_id, payload)
     values ($1, $2, $3, $4::jsonb) returning *`, [
        event.type,
        event.agent_id ?? null,
        event.task_id ?? null,
        event.payload ? JSON.stringify(event.payload) : null,
    ]);
    const row = rows[0];
    // Best effort: a half-open socket can wedge a publish promise
    // forever, so bound it and move on. Events are durable in Postgres.
    try {
        await Promise.race([
            redis.publish('events:all', JSON.stringify(row)),
            new Promise((_, reject) => setTimeout(() => reject(new Error('publish timeout')), 3000)),
        ]);
    }
    catch (err) {
        console.warn('[events] redis publish failed:', (err as Error).message);
    }
    return row;
}

export default async function eventsRoutes(app: any, opts: { ctx: Ctx }) {
    const ctx = opts.ctx;
    const { db } = ctx;

    app.post('/events', {
        schema: {
            body: {
                type: 'object',
                required: ['type'],
                additionalProperties: false,
                properties: {
                    type: { type: 'string', minLength: 1 },
                    agent_id: { type: ['string', 'null'] },
                    task_id: { type: ['number', 'null'] },
                    run_id: { type: ['number', 'null'] },
                    payload: {},
                },
            },
        },
    }, async (request: any, reply: any) => {
        const row = await publishEvent(ctx, request.body as PublishEventInput);
        return reply.code(201).send(row);
    });

    app.get('/events', async (request: any) => {
        const limit = Math.min(Math.max(Number(request.query.limit ?? 100), 1), 500);
        const agentId = request.query.agent_id ?? null;
        const { rows } = agentId
            ? await db.query('select * from events where agent_id = $1 order by id desc limit $2', [agentId, limit])
            : await db.query('select * from events order by id desc limit $1', [limit]);
        return { events: rows };
    });
}
