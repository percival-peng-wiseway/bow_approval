CREATE TABLE IF NOT EXISTS customer_links (
 token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL, email TEXT NOT NULL,
 expires_at INTEGER NOT NULL, used_at INTEGER
);
CREATE INDEX IF NOT EXISTS customer_links_expiry ON customer_links(expires_at);
CREATE TABLE IF NOT EXISTS customer_mail (
 id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL,
 lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, first_attempt INTEGER
);
