CREATE TABLE raw_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site_id VARCHAR(64) NOT NULL,
    event_id VARCHAR(26) NOT NULL,
    schema_version INTEGER NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    path TEXT NOT NULL,
    url TEXT,
    title TEXT,
    referrer TEXT,
    payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT raw_events_site_event_unique UNIQUE (site_id, event_id)
);

CREATE INDEX raw_events_processing_idx
    ON raw_events (site_id, processed_at, id);

CREATE INDEX raw_events_occurred_at_idx
    ON raw_events (site_id, occurred_at);

CREATE TABLE page_view_totals (
    site_id VARCHAR(64) PRIMARY KEY,
    page_views BIGINT NOT NULL DEFAULT 0
);
