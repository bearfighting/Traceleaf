CREATE TABLE normalized_event_context (
    generation_id UUID NOT NULL REFERENCES analytics_generations (generation_id),
    raw_event_id BIGINT NOT NULL REFERENCES raw_events (id),
    site_id VARCHAR(64) NOT NULL,
    context_schema_version INTEGER NOT NULL,
    parser_version VARCHAR(64) NOT NULL,
    language TEXT NOT NULL,
    timezone TEXT NOT NULL,
    viewport_width INTEGER,
    viewport_height INTEGER,
    screen_width INTEGER,
    screen_height INTEGER,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_term TEXT,
    utm_content TEXT,
    referrer_host TEXT NOT NULL,
    device TEXT NOT NULL,
    browser TEXT NOT NULL,
    os TEXT NOT NULL,
    normalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (generation_id, raw_event_id)
);

CREATE INDEX normalized_context_site_day_idx
    ON normalized_event_context (site_id, normalized_at);

CREATE TABLE visitor_event_facts (
    generation_id UUID NOT NULL REFERENCES analytics_generations (generation_id),
    raw_event_id BIGINT NOT NULL REFERENCES raw_events (id),
    site_id VARCHAR(64) NOT NULL,
    visitor_id UUID NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    day DATE NOT NULL,
    PRIMARY KEY (generation_id, raw_event_id)
);

CREATE INDEX visitor_event_facts_lookup_idx
    ON visitor_event_facts (site_id, generation_id, visitor_id, occurred_at);

CREATE TABLE session_events (
    generation_id UUID NOT NULL REFERENCES analytics_generations (generation_id),
    raw_event_id BIGINT NOT NULL REFERENCES raw_events (id),
    site_id VARCHAR(64) NOT NULL,
    visitor_id UUID NOT NULL,
    session_id UUID NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    day DATE NOT NULL,
    PRIMARY KEY (generation_id, raw_event_id)
);

CREATE INDEX session_events_lookup_idx
    ON session_events (site_id, generation_id, visitor_id, occurred_at);

CREATE TABLE sessions (
    generation_id UUID NOT NULL REFERENCES analytics_generations (generation_id),
    session_id UUID NOT NULL,
    site_id VARCHAR(64) NOT NULL,
    visitor_id UUID NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    page_views BIGINT NOT NULL,
    PRIMARY KEY (generation_id, session_id),
    CONSTRAINT sessions_page_views_positive CHECK (page_views > 0)
);

CREATE INDEX sessions_lookup_idx
    ON sessions (site_id, generation_id, visitor_id, started_at);

CREATE TABLE visitor_daily (
    generation_id UUID NOT NULL REFERENCES analytics_generations (generation_id),
    site_id VARCHAR(64) NOT NULL,
    day DATE NOT NULL,
    unique_visitors BIGINT NOT NULL,
    page_views BIGINT NOT NULL,
    PRIMARY KEY (generation_id, site_id, day)
);

CREATE TABLE session_daily (
    generation_id UUID NOT NULL REFERENCES analytics_generations (generation_id),
    site_id VARCHAR(64) NOT NULL,
    day DATE NOT NULL,
    sessions BIGINT NOT NULL,
    page_views BIGINT NOT NULL,
    PRIMARY KEY (generation_id, site_id, day)
);

CREATE TABLE analytics_rebuild_queue (
    queue_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site_id VARCHAR(64) NOT NULL,
    visitor_id UUID,
    scope_from DATE NOT NULL,
    scope_to DATE NOT NULL,
    aggregation_version INTEGER NOT NULL,
    parser_version VARCHAR(64) NOT NULL,
    rebuild_reason VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT analytics_rebuild_queue_scope_check CHECK (scope_from <= scope_to),
    CONSTRAINT analytics_rebuild_queue_version_check CHECK (aggregation_version >= 1),
    CONSTRAINT analytics_rebuild_queue_reason_check
        CHECK (rebuild_reason IN ('initial', 'incremental', 'backfill', 'reparse')),
    CONSTRAINT analytics_rebuild_queue_status_check
        CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);

CREATE UNIQUE INDEX analytics_rebuild_queue_pending_unique_idx
    ON analytics_rebuild_queue (
        site_id,
        visitor_id,
        aggregation_version,
        scope_from,
        scope_to
    )
    NULLS NOT DISTINCT
    WHERE status IN ('pending', 'running');

CREATE INDEX analytics_rebuild_queue_pending_idx
    ON analytics_rebuild_queue (status, updated_at, site_id);

CREATE INDEX analytics_rebuild_queue_visitor_idx
    ON analytics_rebuild_queue (site_id, visitor_id, scope_from, scope_to);
