CREATE TABLE IF NOT EXISTS app_settings (
 id TEXT PRIMARY KEY,
 payload TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
ALTER TABLE accounts ADD COLUMN display_name TEXT;
ALTER TABLE accounts ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN password_updated_at INTEGER;
CREATE TABLE IF NOT EXISTS account_events (
 id TEXT PRIMARY KEY,
 actor TEXT NOT NULL,
 account_id TEXT NOT NULL,
 action TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
