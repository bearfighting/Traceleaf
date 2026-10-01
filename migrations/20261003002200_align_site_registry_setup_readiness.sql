CREATE OR REPLACE VIEW site_registry_setup_status AS
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
            )
          OR EXISTS (
                SELECT 1
                  FROM site_environment_policies AS policy
                 WHERE policy.site_id = site.site_id
                   AND policy.document->>'enabled' = 'true'
                   AND (
                       COALESCE(jsonb_array_length(policy.document->'allowed_origins'), 0) = 0
                       OR COALESCE(jsonb_array_length(policy.document->'ingest_keys'), 0) = 0
                   )
            )
        THEN 'needs_attention'
        ELSE 'ready'
    END AS setup_status
FROM site_registry AS site;

COMMENT ON VIEW site_registry_setup_status IS
    'Derived onboarding readiness. At least one environment must be enabled and every enabled environment must have an Allowed Origin and active Ingest Key. Disabled environments do not affect readiness. Lifecycle remains independent; runtime authorization must not use this view.';
