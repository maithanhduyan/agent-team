import { buildTaskPrompt } from './git.js';
import { publishEvent } from './events.js';
import type { Ctx, Task } from './types.js';

export default async function agentsRoutes(app: any, opts: { ctx: Ctx }) {
    const ctx = opts.ctx;
    const { db } = ctx;

    // ------------------------------------------------------------ register
    app.post('/agents/register', {
        schema: {
            body: {
                type: 'object',
                required: ['id'],
                additionalProperties: false,
                properties: {
                    id: { type: 'string', minLength: 1 },
                    role: { type: 'string' },
                    workspace: { type: ['string', 'null'] },
                },
            },
        },
    }, async (request: any, reply: any) => {
        const { id, role, workspace } = request.body;
        const { rows } = await db.query(`insert into agents (id, role, workspace, status)
         values ($1, $2, $3, 'idle')
         on conflict (id) do update
           set role = excluded.role,
               workspace = excluded.workspace,
               status = 'idle',
               updated_at = now()
         returning *`, [id, role ?? 'agent', workspace ?? null]);
        await publishEvent(ctx, { type: 'agent.registered', agent_id: id });
        return reply.code(201).send(rows[0]);
    });

    // ------------------------------------------------------------- listing
    app.get('/agents', async () => {
        const { rows } = await db.query('select * from agents order by id');
        return { agents: rows };
    });

    // ----------------------------------------------------------- heartbeat
    app.post('/agents/:id/heartbeat', {
        schema: {
            params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
            body: {
                type: 'object',
                additionalProperties: false,
                properties: { status: { type: 'string', enum: ['idle', 'working'] } },
            },
        },
    }, async (request: any, reply: any) => {
        const { id } = request.params;
        const status = request.body.status ?? 'idle';
        const { rows } = await db.query(`insert into agents (id, role, status, last_heartbeat_at)
         values ($1, 'agent', $2, now())
         on conflict (id) do update
           set status = $2, last_heartbeat_at = now(), updated_at = now()
         returning *`, [id, status]);
        return rows[0];
    });

    // ------------------------------------------------- next-task long-poll
    /**
     * Waits (up to ~10s) for a dispatched run, then returns:
     *   200 -> { run_id, task, project, prompt, workspace }
     *   204 -> nothing to do right now (poll again)
     *
     * Postgres is the source of truth for dispatch state; the claim is
     * atomic (only a 'pending' run can be claimed). No blocking Redis
     * commands are used here: sharing one ioredis connection, a BRPOP
     * would serialize every other command behind it for 25s.
     */
    app.get('/agents/:id/next', { schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } }, async (request: any, reply: any) => {
        const agentId = request.params.id;
        // Claim the next pending run atomically (only a 'pending' run
        // can be claimed). Poll a few times so dispatch + pickup happen
        // within a single request instead of forcing an immediate 204.
        let run: any = null;
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
            const { rows } = await db.query(`update agent_runs
           set status = 'running', started_at = now()
           where id = (
             select id from agent_runs
             where agent_id = $1 and status = 'pending'
             order by id
             limit 1
           )
           returning *`, [agentId]);
            if (rows[0]) {
                run = rows[0];
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!run)
            return reply.code(204).send();
        await db.query('update agents set status = $2, updated_at = now() where id = $1', [
            agentId,
            'working',
        ]);
        const taskRes = await db.query('select * from tasks where id = $1', [run.task_id]);
        const task: Task = taskRes.rows[0];
        if (!task) {
            app.log.error({ runId: run.id }, 'run references a missing task');
            return reply.code(500).send({ error: 'run references a missing task' });
        }
        const projectRes = await db.query('select * from projects where id = $1', [
            task.project_id,
        ]);
        const project = projectRes.rows[0] ?? null;
        const job = {
            run_id: run.id,
            agent_id: agentId,
            workspace: '/workspace/project',
            prompt: buildTaskPrompt(task, project, agentId),
            task,
            project,
        };
        await publishEvent(ctx, {
            type: 'run.started',
            agent_id: agentId,
            task_id: task.id,
            run_id: run.id,
            payload: { run_id: run.id },
        });
        return job;
    });
}
