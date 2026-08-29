import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from './config.js';

/** Shared context handed to every route plugin. */
export interface Ctx {
    config: Config;
    db: pg.Pool;
    redis: Redis;
}

export interface Project {
    id: number;
    name: string;
    repository_url: string | null;
    default_branch: string;
    created_at: string;
    updated_at: string;
}

export interface Task {
    id: number;
    project_id: number;
    title: string;
    description: string;
    status: string;
    assigned_agent: string | null;
    priority: string;
    created_at: string;
    updated_at: string;
}

export interface AgentRun {
    id: number;
    agent_id: string;
    task_id: number;
    status: string;
    started_at: string | null;
    finished_at: string | null;
    exit_code: number | null;
    result: unknown;
    created_at: string;
}

export interface Agent {
    id: string;
    role: string;
    status: string;
    workspace: string | null;
    last_heartbeat_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface EventRecord {
    id: number;
    type: string;
    agent_id: string | null;
    task_id: number | null;
    payload: unknown;
    created_at: string;
}

/** Payload accepted by publishEvent (superset of the events table row). */
export interface PublishEventInput {
    type: string;
    agent_id?: string | null;
    task_id?: number | null;
    run_id?: number | null;
    payload?: unknown;
}
