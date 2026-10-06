CREATE TABLE dimension_event_facts (
    generation_id UUID NOT NULL REFERENCES analytics_generations (generation_id),
    raw_event_id BIGINT NOT NULL REFERENCES raw_events (id),
    site_id VARCHAR(64) NOT NULL,
    visitor_id UUID,
    session_id UUID,
    dimension VARCHAR(32) NOT NULL,
    value TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    day DATE NOT NULL,
    PRIMARY KEY (generation_id, raw_event_id, dimension),
    CONSTRAINT dimension_event_facts_dimension_check
        CHECK (dimension IN (
            'language', 'timezone', 'utm_source', 'utm_medium',
            'utm_campaign', 'utm_term', 'utm_content', 'referrer_host',
            'device', 'browser', 'os'
        )),
    CONSTRAINT dimension_event_facts_value_check CHECK (length(value) > 0),
    CONSTRAINT dimension_event_facts_session_visitor_check
        CHECK (visitor_id IS NOT NULL OR session_id IS NULL),
    CONSTRAINT dimension_event_facts_session_fk
        FOREIGN KEY (generation_id, session_id)
        REFERENCES sessions (generation_id, session_id)
);

CREATE INDEX dimension_event_facts_generation_site_occurred_idx
    ON dimension_event_facts (generation_id, site_id, occurred_at);

CREATE INDEX dimension_event_facts_generation_dimension_value_idx
    ON dimension_event_facts (generation_id, site_id, dimension, value, occurred_at);

CREATE INDEX dimension_event_facts_generation_visitor_occurred_idx
    ON dimension_event_facts (generation_id, site_id, visitor_id, occurred_at);

CREATE INDEX dimension_event_facts_generation_session_occurred_idx
    ON dimension_event_facts (generation_id, site_id, session_id, occurred_at);

CREATE TABLE dimension_daily (
    generation_id UUID NOT NULL REFERENCES analytics_generations (generation_id),
    site_id VARCHAR(64) NOT NULL,
    day DATE NOT NULL,
    dimension VARCHAR(32) NOT NULL,
    value TEXT NOT NULL,
    page_views BIGINT NOT NULL,
    unique_visitors BIGINT NOT NULL,
    sessions BIGINT NOT NULL,
    PRIMARY KEY (generation_id, site_id, day, dimension, value),
    CONSTRAINT dimension_daily_dimension_check
        CHECK (dimension IN (
            'language', 'timezone', 'utm_source', 'utm_medium',
            'utm_campaign', 'utm_term', 'utm_content', 'referrer_host',
            'device', 'browser', 'os'
        )),
    CONSTRAINT dimension_daily_value_check CHECK (length(value) > 0),
    CONSTRAINT dimension_daily_counts_check
        CHECK (page_views >= 0 AND unique_visitors >= 0 AND sessions >= 0)
);

CREATE INDEX dimension_daily_generation_lookup_idx
    ON dimension_daily (generation_id, site_id, dimension, day, page_views, value);
