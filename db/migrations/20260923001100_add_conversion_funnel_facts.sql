ALTER TABLE analytics_watermarks
    ADD COLUMN definition_version VARCHAR(64),
    DROP CONSTRAINT analytics_watermarks_generation_scope_check,
    ADD CONSTRAINT analytics_watermarks_generation_scope_check
        CHECK (
            (source_name IN ('page_views', 'custom_events', 'web_vitals', 'conversions', 'funnels') AND generation_id IS NULL)
            OR (source_name NOT IN ('page_views', 'custom_events', 'web_vitals', 'conversions', 'funnels') AND generation_id IS NOT NULL)
        );

ALTER TABLE custom_event_facts
    ADD COLUMN session_id UUID;

CREATE INDEX custom_event_facts_session_idx ON custom_event_facts (site_id, session_id, occurred_at) WHERE session_id IS NOT NULL;

CREATE TABLE conversion_facts (
    site_id VARCHAR(64) NOT NULL,
    definition_id VARCHAR(64) NOT NULL,
    definition_version VARCHAR(64) NOT NULL,
    event_id VARCHAR(26) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    session_id UUID,
    PRIMARY KEY (site_id, definition_id, definition_version, event_id),
    FOREIGN KEY (site_id, event_id) REFERENCES raw_events (site_id, event_id) ON DELETE CASCADE
);
CREATE INDEX conversion_facts_report_idx ON conversion_facts (site_id, definition_id, occurred_at);
CREATE INDEX conversion_facts_session_idx ON conversion_facts (site_id, definition_id, session_id) WHERE session_id IS NOT NULL;

CREATE TABLE funnel_step_facts (
    site_id VARCHAR(64) NOT NULL,
    definition_id VARCHAR(64) NOT NULL,
    definition_version VARCHAR(64) NOT NULL,
    session_id UUID NOT NULL,
    step_index INTEGER NOT NULL,
    event_id VARCHAR(26) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    cohort_day DATE NOT NULL,
    PRIMARY KEY (site_id, definition_id, definition_version, session_id, step_index),
    FOREIGN KEY (site_id, event_id) REFERENCES raw_events (site_id, event_id) ON DELETE CASCADE,
    CHECK (step_index >= 0)
);
CREATE INDEX funnel_step_facts_report_idx ON funnel_step_facts (site_id, definition_id, cohort_day, step_index);
