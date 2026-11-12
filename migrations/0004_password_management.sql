-- Existing accounts and sessions start at version 0; no passwords are changed.
ALTER TABLE accounts ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1));
ALTER TABLE accounts ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
