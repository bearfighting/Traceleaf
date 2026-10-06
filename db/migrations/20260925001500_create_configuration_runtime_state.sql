CREATE TABLE configuration_runtime_state (
    instance_id TEXT NOT NULL CHECK (length(instance_id) BETWEEN 8 AND 64),
    service TEXT NOT NULL CHECK (service = 'collector'),
    site_id VARCHAR(64) NOT NULL CHECK (length(site_id) > 0),
    environment TEXT NOT NULL CHECK (length(btrim(environment)) > 0),
    applied_version BIGINT CHECK (applied_version IS NULL OR applied_version >= 1),
    refresh_status TEXT NOT NULL CHECK (refresh_status IN ('current', 'stale')),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (instance_id, site_id, environment),
    CHECK (refresh_status <> 'current' OR applied_version IS NOT NULL)
);

CREATE INDEX configuration_runtime_state_resource_idx
    ON configuration_runtime_state (site_id, environment, last_seen_at DESC);

CREATE INDEX configuration_runtime_state_expiry_idx
    ON configuration_runtime_state (last_seen_at);

CREATE TABLE configuration_runtime_instances (
    instance_id TEXT PRIMARY KEY CHECK (length(instance_id) BETWEEN 8 AND 64),
    service TEXT NOT NULL CHECK (service = 'collector'),
    refresh_status TEXT NOT NULL CHECK (refresh_status IN ('current', 'stale')),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX configuration_runtime_instances_expiry_idx
    ON configuration_runtime_instances (last_seen_at);
