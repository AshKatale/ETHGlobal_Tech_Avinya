-- Track whether the agent was told to start work once the task was funded.
ALTER TABLE agreements ADD COLUMN IF NOT EXISTS task_dispatch_status text;
ALTER TABLE agreements ADD COLUMN IF NOT EXISTS task_dispatch_error text;
ALTER TABLE agreements ADD COLUMN IF NOT EXISTS task_dispatched_at timestamptz;
