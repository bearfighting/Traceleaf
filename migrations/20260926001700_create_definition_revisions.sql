CREATE TABLE site_definition_revisions (
    site_id VARCHAR(64) NOT NULL REFERENCES site_capability_configurations(site_id) ON DELETE CASCADE,
    revision BIGINT NOT NULL CHECK (revision >= 1),
    definition_version VARCHAR(64) NOT NULL CHECK (length(btrim(definition_version)) > 0),
    effective_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    document JSONB NOT NULL,
    PRIMARY KEY (site_id, revision),
    UNIQUE (site_id, definition_version),
    CONSTRAINT site_definition_revisions_document_check CHECK (
        jsonb_typeof(document) = 'object'
        AND document ?& ARRAY['schema_version', 'site_id', 'revision', 'definition_version', 'updated_at', 'effective_at', 'conversions', 'funnels']
        AND (document->>'schema_version')::INTEGER = 1
        AND document->>'site_id' = site_id
        AND (document->>'revision')::BIGINT = revision
        AND document->>'definition_version' = definition_version
        AND (document->>'effective_at')::TIMESTAMPTZ IS NOT DISTINCT FROM effective_at
        AND jsonb_typeof(document->'conversions') = 'array'
        AND jsonb_typeof(document->'funnels') = 'array'
    )
);

CREATE INDEX site_definition_revisions_effective_idx
    ON site_definition_revisions (site_id, effective_at DESC, revision DESC);

CREATE TABLE definition_revision_watermarks (
    site_id VARCHAR(64) NOT NULL,
    definition_version VARCHAR(64) NOT NULL,
    source_name TEXT NOT NULL CHECK (source_name IN ('conversions', 'funnels')),
    processed_received_watermark TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (site_id, definition_version, source_name),
    FOREIGN KEY (site_id, definition_version)
        REFERENCES site_definition_revisions (site_id, definition_version) ON DELETE CASCADE
);

ALTER TABLE configuration_audit
    DROP CONSTRAINT configuration_audit_resource_check,
    DROP CONSTRAINT configuration_audit_changed_fields_check;

ALTER TABLE configuration_audit
    ADD CONSTRAINT configuration_audit_resource_check CHECK (
        jsonb_typeof(resource) = 'object'
        AND resource ?& ARRAY['kind', 'site_id']
        AND resource->>'kind' IN ('site_capabilities', 'environment_policy', 'ingest_key', 'conversion_funnel_definitions')
        AND jsonb_typeof(resource->'site_id') = 'string'
        AND length(resource->>'site_id') > 0
        AND (resource - ARRAY['kind', 'site_id', 'environment', 'key_id']) = '{}'::jsonb
        AND (
            (resource->>'kind' IN ('site_capabilities', 'conversion_funnel_definitions') AND NOT (resource ? 'environment') AND NOT (resource ? 'key_id'))
            OR (resource->>'kind' = 'environment_policy' AND jsonb_typeof(resource->'environment') = 'string' AND length(resource->>'environment') > 0 AND NOT (resource ? 'key_id'))
            OR (resource->>'kind' = 'ingest_key' AND jsonb_typeof(resource->'environment') = 'string' AND length(resource->>'environment') > 0 AND jsonb_typeof(resource->'key_id') = 'string' AND resource->>'key_id' ~ '^ik_[A-Za-z0-9_-]{8,64}$')
        )
    );

ALTER TABLE configuration_audit
    ADD CONSTRAINT configuration_audit_changed_fields_check CHECK (
        configuration_text_array_is_unique(changed_fields)
        AND changed_fields <@ ARRAY[
            'capabilities', 'environment.enabled', 'environment.allowed_origins',
            'environment.rate_limit_per_minute', 'environment.ingest_keys',
            'definitions.conversions', 'definitions.funnels'
        ]::TEXT[]
    );
