CREATE TABLE IF NOT EXISTS contract_abn_checks (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, request_id TEXT NOT NULL,
 created_at INTEGER NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contract_abn_checks_created ON contract_abn_checks(created_at);
