-- Password as an optional second login factor, plus the user's role. Added to schema.ts without a migration, so databases
-- created earlier lack these columns and every query that reads a whole user row fails with: column "email" does not exist.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text;
