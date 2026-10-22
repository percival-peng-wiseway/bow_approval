PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY, username TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE,
 role TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_meta (
 id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0,
 imported INTEGER NOT NULL DEFAULT 0, last_commit TEXT NOT NULL DEFAULT '', base_json TEXT NOT NULL DEFAULT '{}'
);
INSERT OR IGNORE INTO workspace_meta(id) VALUES(1);
CREATE TABLE IF NOT EXISTS entities (
 collection TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, position INTEGER NOT NULL,
 PRIMARY KEY(collection,id)
);
CREATE TABLE IF NOT EXISTS approval_events (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor TEXT NOT NULL,
 action TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS approval_events_request ON approval_events(request_id,created_at);
CREATE TABLE IF NOT EXISTS files (
 id TEXT PRIMARY KEY, object_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, mime_type TEXT NOT NULL,
 size INTEGER NOT NULL, uploaded_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 committed INTEGER NOT NULL DEFAULT 0 CHECK(committed IN (0,1))
);
CREATE TABLE IF NOT EXISTS workspace_commits (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL UNIQUE, actor TEXT NOT NULL,
 operation TEXT NOT NULL, created_at INTEGER NOT NULL
);
