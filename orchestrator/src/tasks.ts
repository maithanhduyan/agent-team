import { publishEvent } from './events.js';
import type { Ctx } from './types.js';

/**
 * Project/task API + dispatch + run-result ingestion.
 *
 * Dispatch flow:
 *   POST /tasks/:id/dispatch
 *     -> insert agent_run (pending), task -> in_progress
 *     -> runner claims it via GET /agents/:id/next (atomic pending->running)
 *     -> runner executes `dsh --profile headless "<prompt>"`
 *     -> runner POSTs /agents/:id/runs/:runId/result
 *     -> on success, dependents whose prerequisites are all done
 *        are dispatched automatically
 */
const RUNNABLE_STATUSES = new Set(['todo', 'in_progress', 'failed', 'blocked']);

export async function dispatchTask(ctx: Ctx, taskId: number) {
    const { db } = ctx;
    const taskRes = await db.query('select * from tasks where id = $1', [taskId]);
    const task = taskRes.rows[0];
    if (!task)
        throw new Error(`task ${taskId} not found`);
    if (!task.assigned_agent)
        throw new Error(`task ${taskId} has no assigned agent`);
    if (!RUNNABLE_STATUSES.has(task.status)) {
        throw new Error(`task ${taskId} is not runnable (status=${task.status})`);
    }
    const active = await db.query(`select 1 from agent_runs where task_id = $1 and status in ('pending', 'running') limit 1`, [taskId]);
    if (active.rows.length > 0)
        throw new Error(`task ${taskId} already has an active run`);
    const { rows } = await db.query(`insert into agent_runs (agent_id, task_id, status)
     values ($1, $2, 'pending') returning *`, [task.assigned_agent, taskId]);
    const run = rows[0];
    await db.query(`update tasks set status = 'in_progress', updated_at = now() where id = $1`, [
        taskId,
    ]);
    // Dispatch state lives in Postgres: the runner claims the run via
    // GET /agents/:id/next. (No Redis queue — a shared ioredis
    // connection would serialize behind long BRPOPs; Redis is used
    // only as the event bus in events.ts.)
    await publishEvent(ctx, {
        type: 'task.dispatched',
        agent_id: task.assigned_agent,
        task_id: taskId,
        run_id: run.id,
        payload: { run_id: run.id },
    });
    return run;
}

/** After a task succeeds, dispatch every dependent whose prerequisites are all done. */
async function maybeDispatchDependents(ctx: Ctx, taskId: number) {
    const { db } = ctx;
    const { rows: candidates } = await db.query(`select t.id from tasks t
     join task_dependencies d on d.task_id = t.id
     where d.depends_on_task_id = $1 and t.status = 'todo'`, [taskId]);
    for (const candidate of candidates) {
        const blocked = await db.query(`select 1 from task_dependencies d
       join tasks dep on dep.id = d.depends_on_task_id
       where d.task_id = $1 and dep.status <> 'done'
       limit 1`, [candidate.id]);
        if (blocked.rows.length > 0)
            continue;
        const taskRes = await db.query('select * from tasks where id = $1', [candidate.id]);
        if (taskRes.rows[0]?.assigned_agent) {
            try {
                await dispatchTask(ctx, candidate.id);
            }
            catch (err) {
                console.warn(`[dispatch] auto-dispatch of task ${candidate.id} failed:`, (err as Error).message);
            }
        }
    }
}

export default async function tasksRoutes(app: any, opts: { ctx: Ctx }) {
    const ctx = opts.ctx;
    const { db } = ctx;

    // ------------------------------------------------------------- projects
    app.post('/projects', {
        schema: {
            body: {
                type: 'object',
                required: ['name'],
                additionalProperties: false,
                properties: {
                    name: { type: 'string', minLength: 1 },
                    repository_url: { type: ['string', 'null'] },
                    default_branch: { type: 'string' },
                },
            },
        },
    }, async (request: any, reply: any) => {
        const { name, repository_url, default_branch } = request.body;
        try {
            const { rows } = await db.query(`insert into projects (name, repository_url, default_branch)
           values ($1, $2, $3) returning *`, [name, repository_url ?? null, default_branch ?? 'main']);
            await publishEvent(ctx, { type: 'project.created', payload: { project_id: rows[0].id } });
            return reply.code(201).send(rows[0]);
        }
        catch (err) {
            if ((err as { code?: string }).code === '23505') {
                return reply.code(409).send({ error: `project "${name}" already exists` });
            }
            throw err;
        }
    });

    app.get('/projects', async () => {
        const { rows } = await db.query('select * from projects order by id');
        return { projects: rows };
    });

    // ---------------------------------------------------------------- tasks
    app.post('/tasks', {
        schema: {
            body: {
                type: 'object',
                required: ['project_id', 'title'],
                additionalProperties: false,
                properties: {
                    project_id: { type: 'number' },
                    title: { type: 'string', minLength: 1 },
                    description: { type: 'string' },
                    assigned_agent: { type: 'string' },
                    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
                    depends_on: { type: 'array', items: { type: 'number' } },
                },
            },
        },
    }, async (request: any, reply: any) => {
        const { project_id, title, description, assigned_agent, priority, depends_on } = request.body;
        const project = await db.query('select 1 from projects where id = $1', [project_id]);
        if (project.rows.length === 0) {
            return reply.code(404).send({ error: `project ${project_id} not found` });
        }
        const client = await db.connect();
        try {
            await client.query('begin');
            const { rows } = await client.query(`insert into tasks (project_id, title, description, assigned_agent, priority)
           values ($1, $2, $3, $4, $5) returning *`, [project_id, title, description ?? '', assigned_agent ?? null, priority ?? 'medium']);
            const task = rows[0];
            for (const dep of depends_on ?? []) {
                await client.query(`insert into task_dependencies (task_id, depends_on_task_id) values ($1, $2)`, [task.id, dep]);
            }
            await client.query('commit');
            await publishEvent(ctx, { type: 'task.created', task_id: task.id, payload: { title } });
            return reply.code(201).send(task);
        }
        catch (err) {
            await client.query('rollback');
            if ((err as { code?: string }).code === '23503') {
                // FK violation: assigned_agent is not a registered agent.
                return reply.code(409).send({
                    error: `agent "${assigned_agent ?? ''}" is not registered — start the agent container first (the runner registers on boot)`,
                });
            }
            throw err;
        }
        finally {
            client.release();
        }
    });

    app.get('/tasks', async (request: any) => {
        const { status, agent, project_id } = request.query;
        const where = [];
        const params = [];
        if (status) {
            params.push(status);
            where.push(`status = $${params.length}`);
        }
        if (agent) {
            params.push(agent);
            where.push(`assigned_agent = $${params.length}`);
        }
        if (project_id) {
            params.push(Number(project_id));
            where.push(`project_id = $${params.length}`);
        }
        const sql = `select * from tasks` +
            (where.length ? ` where ${where.join(' and ')}` : '') +
            ` order by id`;
        const { rows } = await db.query(sql, params);
        return { tasks: rows };
    });

    app.get('/tasks/:id', async (request: any, reply: any) => {
        const { rows } = await db.query('select * from tasks where id = $1', [
            Number(request.params.id),
        ]);
        if (!rows[0])
            return reply.code(404).send({ error: 'task not found' });
        const deps = await db.query('select depends_on_task_id from task_dependencies where task_id = $1 order by depends_on_task_id', [rows[0].id]);
        return { ...rows[0], depends_on: deps.rows.map((d: any) => d.depends_on_task_id) };
    });

    // -------------------------------------------------------------- dispatch
    app.post('/tasks/:id/dispatch', { schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } }, async (request: any, reply: any) => {
        try {
            const run = await dispatchTask(ctx, Number(request.params.id));
            const task = await db.query('select * from tasks where id = $1', [
                Number(request.params.id),
            ]);
            return { run, task: task.rows[0] };
        }
        catch (err) {
            const message = (err as Error).message;
            if (message.includes('not found'))
                return reply.code(404).send({ error: message });
            if (message.includes('no assigned agent') || message.includes('not runnable')) {
                return reply.code(409).send({ error: message });
            }
            if (message.includes('active run'))
                return reply.code(409).send({ error: message });
            throw err;
        }
    });

    // ---------------------------------------------------------------- result
    app.post('/agents/:id/runs/:runId/result', {
        schema: {
            params: {
                type: 'object',
                required: ['id', 'runId'],
                properties: { id: { type: 'string' }, runId: { type: 'string' } },
            },
            body: {
                type: 'object',
                required: ['status'],
                additionalProperties: false,
                properties: {
                    status: { type: 'string', enum: ['succeeded', 'failed'] },
                    exit_code: { type: 'number' },
                    output: { type: 'string' },
                    branch: { type: ['string', 'null'] },
                    pr_url: { type: ['string', 'null'] },
                    summary: { type: 'string' },
                },
            },
        },
    }, async (request: any, reply: any) => {
        const { id: agentId, runId } = request.params;
        const { status, exit_code, output, branch, pr_url, summary } = request.body;
        const { rows } = await db.query(`update agent_runs
         set status = $1,
             finished_at = now(),
             exit_code = $2,
             result = jsonb_build_object(
               'output', $3::text,
               'summary', $4::text,
               'branch', $5::text,
               'pr_url', $6::text
             )
         where id = $7 and agent_id = $8 and status = 'running'
         returning *`, [status, exit_code ?? null, output ?? null, summary ?? null, branch ?? null, pr_url ?? null, Number(runId), agentId]);
        if (rows.length === 0) {
            return reply.code(404).send({ error: `no running run ${runId} for agent ${agentId}` });
        }
        const run = rows[0];
        await db.query('update agents set status = $2, updated_at = now() where id = $1', [
            agentId,
            'idle',
        ]);
        const taskStatus = status === 'succeeded' ? 'done' : 'failed';
        await db.query('update tasks set status = $2, updated_at = now() where id = $1', [
            run.task_id,
            taskStatus,
        ]);
        if (branch || pr_url) {
            await db.query(`insert into pull_requests (task_id, agent_id, branch, url)
           values ($1, $2, $3, $4)
           on conflict (task_id, branch) do update set url = excluded.url, status = 'open'`, [run.task_id, agentId, branch ?? null, pr_url ?? null]);
        }
        await publishEvent(ctx, {
            type: status === 'succeeded' ? 'task.succeeded' : 'task.failed',
            agent_id: agentId,
            task_id: run.task_id,
            run_id: run.id,
            payload: { exit_code, branch, pr_url, summary },
        });
        if (status === 'succeeded') {
            await maybeDispatchDependents(ctx, run.task_id);
        }
        return { run, task_id: run.task_id };
    });
}
