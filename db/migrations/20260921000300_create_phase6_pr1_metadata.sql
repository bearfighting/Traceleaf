ALTER TABLE raw_events
    ADD COLUMN visitor_id UUID,
    ADD COLUMN context_schema_version INTEGER;

CREATE INDEX raw_events_site_visitor_occurred_idx
    ON raw_events (site_id, visitor_id, occurred_at);

CREATE INDEX raw_events_site_received_idx
    ON raw_events (site_id, received_at);

CREATE TABLE analytics_feature_flags (
    site_id VARCHAR(64) PRIMARY KEY,
    protocol_v2_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    analytics_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE analytics_generations (
    generation_id UUID PRIMARY KEY,
    site_id VARCHAR(64) NOT NULL,
    aggregation_version INTEGER NOT NULL,
    parser_version VARCHAR(64) NOT NULL,
    scope_from DATE,
    scope_to DATE,
    rebuild_reason VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL,
    source_watermark JSONB NOT NULL DEFAULT '{}'::jsonb,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    CONSTRAINT analytics_generations_aggregation_version_check
        CHECK (aggregation_version >= 1),
    CONSTRAINT analytics_generations_scope_check
        CHECK (
            (scope_from IS NULL AND scope_to IS NULL)
            OR (scope_from IS NOT NULL AND scope_to IS NOT NULL AND scope_from <= scope_to)
        ),
    CONSTRAINT analytics_generations_reason_check
        CHECK (rebuild_reason IN ('initial', 'incremental', 'backfill', 'reparse')),
    CONSTRAINT analytics_generations_status_check
        CHECK (status IN ('building', 'active', 'retired', 'failed'))
);

CREATE UNIQUE INDEX analytics_generations_one_active_per_site_idx
    ON analytics_generations (site_id)
    WHERE status = 'active';

CREATE TABLE analytics_watermarks (
    watermark_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site_id VARCHAR(64) NOT NULL,
    generation_id UUID REFERENCES analytics_generations (generation_id),
    source_name VARCHAR(64) NOT NULL,
    processed_received_watermark TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX analytics_watermarks_source_unique_idx
    ON analytics_watermarks (site_id, generation_id, source_name) NULLS NOT DISTINCT;

CREATE INDEX analytics_watermarks_lookup_idx
    ON analytics_watermarks (site_id, source_name, processed_received_watermark);
