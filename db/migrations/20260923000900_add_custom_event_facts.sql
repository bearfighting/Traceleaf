ALTER TABLE raw_events
    ALTER COLUMN path DROP NOT NULL,
    ADD CONSTRAINT raw_events_page_view_path_required
        CHECK (event_type <> 'page_view' OR path IS NOT NULL);

ALTER TABLE analytics_watermarks
    DROP CONSTRAINT analytics_watermarks_generation_scope_check,
    ADD CONSTRAINT analytics_watermarks_generation_scope_check
        CHECK (
            (source_name IN ('page_views', 'custom_events') AND generation_id IS NULL)
            OR (source_name NOT IN ('page_views', 'custom_events') AND generation_id IS NOT NULL)
        );

CREATE TABLE custom_event_facts (
    raw_event_id BIGINT PRIMARY KEY REFERENCES raw_events (id) ON DELETE CASCADE,
    site_id VARCHAR(64) NOT NULL,
    event_id VARCHAR(26) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    event_name VARCHAR(64) NOT NULL,
    CONSTRAINT custom_event_facts_site_event_unique UNIQUE (site_id, event_id)
);

CREATE INDEX custom_event_facts_report_idx
    ON custom_event_facts (site_id, occurred_at, event_name);
