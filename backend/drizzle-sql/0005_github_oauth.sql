-- GitHub OAuth for private-repo onboarding: one connection per user; states are single use and expire quickly.
CREATE TABLE IF NOT EXISTS github_connections (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  github_login text NOT NULL,
  github_id text NOT NULL,
  access_token text NOT NULL,
  scope text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS github_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);
