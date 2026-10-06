ALTER TABLE raw_events
    ADD CONSTRAINT raw_events_web_vital_path_required
        CHECK (event_type <> 'web_vital' OR path IS NOT NULL);

ALTER TABLE analytics_watermarks
    DROP CONSTRAINT analytics_watermarks_generation_scope_check,
    ADD CONSTRAINT analytics_watermarks_generation_scope_check
        CHECK (
            (source_name IN ('page_views', 'custom_events', 'web_vitals') AND generation_id IS NULL)
            OR (source_name NOT IN ('page_views', 'custom_events', 'web_vitals') AND generation_id IS NOT NULL)
        );

CREATE TABLE web_vital_facts (
    raw_event_id BIGINT NOT NULL REFERENCES raw_events(id) ON DELETE CASCADE,
    site_id VARCHAR(64) NOT NULL,
    page_view_event_id VARCHAR(26) NOT NULL,
    page_view_occurred_at TIMESTAMPTZ NOT NULL,
    path TEXT NOT NULL,
    metric VARCHAR(8) NOT NULL CHECK (metric IN ('LCP','INP','CLS','FCP','TTFB')),
    value DOUBLE PRECISION NOT NULL CHECK (value >= 0),
    rating VARCHAR(20) NOT NULL CHECK (rating IN ('good','needs_improvement','poor')),
    navigation_type VARCHAR(20) NOT NULL,
    report_sequence BIGINT NOT NULL CHECK (report_sequence > 0),
    CONSTRAINT web_vital_facts_page_metric_unique UNIQUE(site_id,page_view_event_id,metric),
    CONSTRAINT web_vital_facts_page_view_fk FOREIGN KEY(site_id,page_view_event_id) REFERENCES raw_events(site_id,event_id) ON DELETE CASCADE
);
CREATE INDEX web_vital_facts_report_idx ON web_vital_facts(site_id,page_view_occurred_at,path,metric);
