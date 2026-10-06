CREATE TABLE geo_event_metadata (
    raw_event_id BIGINT PRIMARY KEY REFERENCES raw_events(id) ON DELETE CASCADE,
    site_id VARCHAR(64) NOT NULL,
    country_code TEXT NOT NULL CHECK (country_code = 'unknown' OR country_code ~ '^[A-Z]{2}$'),
    provider TEXT NOT NULL,
    dataset_version TEXT NOT NULL,
    parser_version TEXT NOT NULL,
    CONSTRAINT geo_event_metadata_site_event_unique UNIQUE (site_id, raw_event_id)
);

CREATE TABLE geo_country_facts (
    raw_event_id BIGINT PRIMARY KEY REFERENCES raw_events(id) ON DELETE CASCADE,
    site_id VARCHAR(64) NOT NULL,
    country_code TEXT NOT NULL CHECK (country_code = 'unknown' OR country_code ~ '^[A-Z]{2}$'),
    occurred_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT geo_country_facts_event_metadata_fk
        FOREIGN KEY (site_id, raw_event_id)
        REFERENCES geo_event_metadata(site_id, raw_event_id) ON DELETE CASCADE
);

CREATE INDEX geo_country_facts_site_occurred_country_idx
    ON geo_country_facts (site_id, occurred_at, country_code);
