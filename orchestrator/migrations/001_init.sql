-- ==========================================================
-- ai-dev-team initial schema
-- ==========================================================

create table if not exists agents (
  id                text primary key,
  role              text not null default 'agent',
  status            text not null default 'offline'
                    check (status in ('offline', 'idle', 'working')),
  workspace         text,
  last_heartbeat_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists projects (
  id              bigserial primary key,
  name            text not null unique,
  repository_url  text,
  default_branch  text not null default 'main',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists tasks (
  id              bigserial primary key,
  project_id      bigint not null references projects (id) on delete cascade,
  title           text not null,
  description     text not null default '',
  status          text not null default 'todo'
                  check (status in ('todo', 'in_progress', 'done', 'failed', 'blocked', 'cancelled')),
  assigned_agent  text references agents (id),
  priority        text not null default 'medium'
                  check (priority in ('low', 'medium', 'high', 'urgent')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists tasks_status_idx  on tasks (status);
create index if not exists tasks_agent_idx   on tasks (assigned_agent);
create index if not exists tasks_project_idx on tasks (project_id);

create table if not exists task_dependencies (
  task_id             bigint not null references tasks (id) on delete cascade,
  depends_on_task_id  bigint not null references tasks (id) on delete cascade,
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

create table if not exists agent_runs (
  id           bigserial primary key,
  agent_id     text not null references agents (id),
  task_id      bigint not null references tasks (id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  started_at   timestamptz,
  finished_at  timestamptz,
  exit_code    int,
  result       jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists agent_runs_agent_status_idx on agent_runs (agent_id, status);
create index if not exists agent_runs_task_idx        on agent_runs (task_id);

create table if not exists pull_requests (
  id           bigserial primary key,
  task_id      bigint not null references tasks (id) on delete cascade,
  agent_id     text not null references agents (id),
  repository   text,
  branch       text,
  pr_number    int,
  status       text not null default 'open',
  url          text,
  created_at   timestamptz not null default now(),
  unique (task_id, branch)
);

create table if not exists events (
  id          bigserial primary key,
  type        text not null,
  agent_id    text references agents (id),
  task_id     bigint references tasks (id) on delete set null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists events_created_idx on events (created_at desc);
create index if not exists events_task_idx    on events (task_id);
