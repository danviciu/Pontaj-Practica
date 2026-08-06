-- Pontaj Practica — D1 schema.
-- One row per entity record. The full record lives as JSON in `data`; a few
-- columns are promoted for indexing/uniqueness and tenant isolation.

CREATE TABLE IF NOT EXISTS records (
    entity       TEXT NOT NULL,
    id           TEXT NOT NULL,
    owner_id     TEXT,
    email        TEXT,            -- lowercased; set for User records
    data         TEXT NOT NULL,   -- full JSON record
    created_date TEXT,
    PRIMARY KEY (entity, id)
);

CREATE INDEX IF NOT EXISTS idx_records_entity ON records(entity);
CREATE INDEX IF NOT EXISTS idx_records_owner ON records(entity, owner_id);

-- Enforce unique email across User records at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_records_user_email
    ON records(email)
    WHERE entity = 'User' AND email IS NOT NULL;

-- Append-only navigation logs (write-only telemetry; never loaded into state).
CREATE TABLE IF NOT EXISTS nav_logs (
    id        TEXT PRIMARY KEY,
    user_id   TEXT,
    page_name TEXT,
    timestamp TEXT
);
