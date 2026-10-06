CREATE TABLE configuration_capability_runtime_instances (
    service TEXT NOT NULL CHECK (service IN ('collector', 'processor', 'analytics_api')),
    instance_id TEXT NOT NULL CHECK (length(instance_id) BETWEEN 8 AND 96),
    refresh_status TEXT NOT NULL CHECK (refresh_status IN ('current', 'stale')),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (service, instance_id)
);

CREATE INDEX configuration_capability_runtime_instances_expiry_idx
    ON configuration_capability_runtime_instances (last_seen_at);

CREATE TABLE configuration_capability_runtime_state (
    service TEXT NOT NULL CHECK (service IN ('collector', 'processor', 'analytics_api')),
    instance_id TEXT NOT NULL,
    site_id VARCHAR(64) NOT NULL CHECK (length(site_id) > 0),
    applied_version BIGINT CHECK (applied_version IS NULL OR applied_version >= 1),
    refresh_status TEXT NOT NULL CHECK (refresh_status IN ('current', 'stale')),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (service, instance_id, site_id),
    FOREIGN KEY (service, instance_id)
        REFERENCES configuration_capability_runtime_instances(service, instance_id)
        ON DELETE CASCADE,
    CHECK (refresh_status <> 'current' OR applied_version IS NOT NULL)
);

CREATE INDEX configuration_capability_runtime_resource_idx
    ON configuration_capability_runtime_state (site_id, service, last_seen_at DESC);

CREATE INDEX configuration_capability_runtime_expiry_idx
    ON configuration_capability_runtime_state (last_seen_at);

CREATE TABLE site_capability_activation_windows (
    site_id VARCHAR(64) NOT NULL REFERENCES site_capability_configurations(site_id) ON DELETE CASCADE,
    capability_id TEXT NOT NULL CHECK (capability_id IN (
        'page_views', 'browser_context', 'anonymous_visitors', 'sessions', 'dimensions',
        'custom_events', 'web_vitals', 'conversions', 'funnels', 'geo'
    )),
    enabled_since TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (site_id, capability_id)
);

INSERT INTO site_capability_activation_windows (site_id, capability_id, enabled_since)
SELECT configurations.site_id, capability.key, '0001-01-01T00:00:00Z'::TIMESTAMPTZ
FROM site_capability_configurations AS configurations
CROSS JOIN LATERAL jsonb_each(configurations.document->'capabilities') AS capability(key, value)
WHERE capability.value->>'enabled' = 'true';

CREATE INDEX site_capability_activation_windows_site_idx
    ON site_capability_activation_windows (site_id, capability_id);
