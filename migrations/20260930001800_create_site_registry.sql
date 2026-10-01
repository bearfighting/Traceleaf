CREATE TABLE site_registry (
    site_id VARCHAR(64) PRIMARY KEY CHECK (length(site_id) > 0),
    display_name TEXT CHECK (display_name IS NULL OR length(btrim(display_name)) > 0),
    website_url TEXT CHECK (website_url IS NULL OR length(btrim(website_url)) > 0),
    lifecycle_status TEXT NOT NULL DEFAULT 'active'
        CHECK (lifecycle_status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (updated_at >= created_at)
);

COMMENT ON TABLE site_registry IS
    'Stable Site identity and editable metadata. setup_status is derived by site_registry_setup_status. This migration does not switch runtime configuration authority; Collector authorization retains its existing behavior until the M4 cutover.';

COMMENT ON COLUMN site_registry.website_url IS
    'Canonical website URL metadata. NULL is allowed for historical Sites; Allowed Origins must never be copied here automatically.';

COMMENT ON COLUMN site_registry.updated_at IS
    'Site Management and importer writes must update this timestamp when a Registry row changes; no-op idempotent imports must leave it unchanged.';

CREATE VIEW site_registry_setup_status AS
SELECT
    site.site_id,
    CASE
        WHEN site.display_name IS NULL
          OR site.website_url IS NULL
          OR NOT EXISTS (
                SELECT 1
                  FROM site_capability_configurations AS capabilities
                 WHERE capabilities.site_id = site.site_id
                   AND capabilities.document #>> '{capabilities,page_views,enabled}' = 'true'
            )
          OR NOT EXISTS (
                SELECT 1
                  FROM site_environment_policies AS policy
                 WHERE policy.site_id = site.site_id
                   AND policy.document->>'enabled' = 'true'
                   AND jsonb_array_length(policy.document->'allowed_origins') > 0
                   AND jsonb_array_length(policy.document->'ingest_keys') > 0
            )
        THEN 'needs_attention'
        ELSE 'ready'
    END AS setup_status
FROM site_registry AS site;

COMMENT ON VIEW site_registry_setup_status IS
    'Derived onboarding readiness; lifecycle_status is independent and no runtime service should use this view as ingest authorization.';
