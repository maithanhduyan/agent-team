-- Two-way Redmine sync: link orchestrator tasks to Redmine issues.
-- The sync poller imports open Redmine issues (subject convention
-- "[<agent>] <title>") as tasks and records the Redmine issue id here;
-- the result route uses it to close/update the issue when the task
-- finishes. The partial unique index keeps the import idempotent.
alter table tasks add column if not exists redmine_issue_id bigint;
create unique index if not exists tasks_redmine_issue_id_idx
  on tasks(redmine_issue_id) where redmine_issue_id is not null;
