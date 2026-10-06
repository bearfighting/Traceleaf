DO $$
DECLARE
    table_name TEXT;
    orphan_count BIGINT;
    site_tables CONSTANT TEXT[] := ARRAY[
        'analytics_feature_flags',
        'site_capability_configurations',
        'site_capability_activation_windows',
        'site_environment_policies',
        'site_definition_revisions',
        'raw_events',
        'page_view_totals',
        'page_view_daily',
        'page_view_routes',
        'normalized_event_context',
        'visitor_event_facts',
        'visitor_daily',
        'sessions',
        'session_events',
        'session_daily',
        'dimension_event_facts',
        'dimension_daily',
        'web_vital_facts',
        'custom_event_facts',
        'conversion_facts',
        'funnel_step_facts',
        'geo_event_metadata',
        'geo_country_facts'
    ];
BEGIN
    FOREACH table_name IN ARRAY site_tables LOOP
        EXECUTE format(
            'SELECT count(*) FROM %I AS child LEFT JOIN site_registry AS parent USING (site_id) WHERE parent.site_id IS NULL',
            table_name
        ) INTO orphan_count;
        IF orphan_count > 0 THEN
            RAISE EXCEPTION 'cannot add Site Registry reference: %.site_id has % orphan rows', table_name, orphan_count
                USING HINT = 'Run the M3 target preflight/importer and resolve every orphan before retrying this migration.';
        END IF;

        EXECUTE format(
            'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (site_id) REFERENCES site_registry(site_id) ON DELETE RESTRICT',
            table_name,
            table_name || '_site_registry_fk'
        );
    END LOOP;
END
$$;
