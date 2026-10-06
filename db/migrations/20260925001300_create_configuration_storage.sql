CREATE FUNCTION configuration_datetime_is_valid(value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
BEGIN
    IF value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
        RETURN FALSE;
    END IF;
    PERFORM value::TIMESTAMPTZ;
    RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
END;
$$;

CREATE FUNCTION configuration_normalize_origin(value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    normalized TEXT := lower(regexp_replace(value, '/$', ''));
    scheme TEXT;
    ipv6_authority TEXT;
    ipv6_host TEXT;
    ipv6_suffix TEXT;
BEGIN
    IF normalized ~ '^https?://\[[^]]+\]' THEN
        scheme := substring(normalized FROM '^(https?://)');
        ipv6_authority := substring(normalized FROM '^https?://(\[[^]]+\])');
        ipv6_host := substring(ipv6_authority FROM '^\[([^]]+)\]');
        ipv6_suffix := substring(normalized FROM '^https?://\[[^]]+\](.*)$');
        normalized := scheme || '[' || host(ipv6_host::INET) || ']' || ipv6_suffix;
    END IF;

    IF normalized LIKE 'http://%' AND normalized ~ ':0*80$' THEN
        normalized := regexp_replace(normalized, ':0*80$', '');
    ELSIF normalized LIKE 'https://%' AND normalized ~ ':0*443$' THEN
        normalized := regexp_replace(normalized, ':0*443$', '');
    END IF;
    RETURN normalized;
END;
$$;

CREATE FUNCTION configuration_capabilities_document_is_valid(value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    capability_name TEXT;
    capability JSONB;
    allowed_names CONSTANT TEXT[] := ARRAY[
        'page_views', 'browser_context', 'anonymous_visitors', 'sessions',
        'dimensions', 'custom_events', 'web_vitals', 'conversions', 'funnels', 'geo'
    ];
BEGIN
    IF jsonb_typeof(value) <> 'object'
       OR NOT (value ?& allowed_names)
       OR (value - allowed_names) <> '{}'::jsonb THEN
        RETURN FALSE;
    END IF;

    FOR capability_name IN SELECT jsonb_object_keys(value) LOOP
        capability := value->capability_name;
        IF jsonb_typeof(capability) <> 'object'
           OR NOT (capability ?& ARRAY['enabled', 'settings'])
           OR (capability - ARRAY['enabled', 'settings']) <> '{}'::jsonb
           OR jsonb_typeof(capability->'enabled') <> 'boolean'
           OR capability->'settings' <> '{}'::jsonb THEN
            RETURN FALSE;
        END IF;
    END LOOP;
    RETURN TRUE;
END;
$$;

CREATE FUNCTION configuration_environment_policy_document_is_valid(value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    origin JSONB;
    origin_text TEXT;
    seen_origins TEXT[] := ARRAY[]::TEXT[];
    normalized_origin TEXT;
    stored_key JSONB;
    key_id TEXT;
    seen_key_ids TEXT[] := ARRAY[]::TEXT[];
    allowed_fields CONSTANT TEXT[] := ARRAY[
        'schema_version', 'site_id', 'environment', 'version', 'updated_at',
        'enabled', 'allowed_origins', 'ingest_keys', 'rate_limit_per_minute'
    ];
BEGIN
    IF jsonb_typeof(value) <> 'object'
       OR NOT (value ?& allowed_fields)
       OR (value - allowed_fields) <> '{}'::jsonb
       OR jsonb_typeof(value->'schema_version') <> 'number'
       OR (value->>'schema_version')::NUMERIC <> 1
       OR jsonb_typeof(value->'site_id') <> 'string'
       OR length(value->>'site_id') = 0
       OR jsonb_typeof(value->'environment') <> 'string'
       OR length(value->>'environment') = 0
       OR jsonb_typeof(value->'version') <> 'number'
       OR (value->>'version')::NUMERIC < 1
       OR trunc((value->>'version')::NUMERIC) <> (value->>'version')::NUMERIC
       OR jsonb_typeof(value->'updated_at') <> 'string'
       OR NOT configuration_datetime_is_valid(value->>'updated_at')
       OR jsonb_typeof(value->'enabled') <> 'boolean'
       OR jsonb_typeof(value->'allowed_origins') <> 'array'
       OR jsonb_array_length(value->'allowed_origins') < 1
       OR jsonb_typeof(value->'ingest_keys') <> 'array'
       OR jsonb_array_length(value->'ingest_keys') < 1
       OR jsonb_typeof(value->'rate_limit_per_minute') <> 'number'
       OR (value->>'rate_limit_per_minute')::NUMERIC < 1
       OR trunc((value->>'rate_limit_per_minute')::NUMERIC) <> (value->>'rate_limit_per_minute')::NUMERIC THEN
        RETURN FALSE;
    END IF;

    FOR origin IN SELECT jsonb_array_elements(value->'allowed_origins') LOOP
        IF jsonb_typeof(origin) <> 'string' THEN
            RETURN FALSE;
        END IF;
        origin_text := origin #>> '{}';
        IF origin_text !~ '^https?://(([A-Za-z0-9-]+\.)*[A-Za-z0-9-]*[A-Za-z][A-Za-z0-9-]*|(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}|\[[A-Fa-f0-9.]*:[A-Fa-f0-9:.]*\])(:(0|[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?/?$' THEN
            RETURN FALSE;
        END IF;
        normalized_origin := configuration_normalize_origin(origin_text);
        IF normalized_origin = ANY(seen_origins) THEN
            RETURN FALSE;
        END IF;
        seen_origins := array_append(seen_origins, normalized_origin);
    END LOOP;

    FOR stored_key IN SELECT jsonb_array_elements(value->'ingest_keys') LOOP
        IF jsonb_typeof(stored_key) <> 'object'
           OR NOT (stored_key ?& ARRAY['key_id', 'sha256_digest', 'created_at'])
           OR (stored_key - ARRAY['key_id', 'sha256_digest', 'created_at']) <> '{}'::jsonb
           OR jsonb_typeof(stored_key->'key_id') <> 'string'
           OR jsonb_typeof(stored_key->'sha256_digest') <> 'string'
           OR jsonb_typeof(stored_key->'created_at') <> 'string' THEN
            RETURN FALSE;
        END IF;
        key_id := stored_key->>'key_id';
        IF key_id !~ '^ik_[A-Za-z0-9_-]{8,64}$'
           OR (stored_key->>'sha256_digest') !~ '^[a-f0-9]{64}$'
           OR key_id = ANY(seen_key_ids)
           OR NOT configuration_datetime_is_valid(stored_key->>'created_at') THEN
            RETURN FALSE;
        END IF;
        seen_key_ids := array_append(seen_key_ids, key_id);
    END LOOP;
    RETURN TRUE;
END;
$$;

CREATE FUNCTION configuration_text_array_is_unique(value TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    field TEXT;
    seen_fields TEXT[] := ARRAY[]::TEXT[];
BEGIN
    FOREACH field IN ARRAY value LOOP
        IF field IS NULL OR field = ANY(seen_fields) THEN
            RETURN FALSE;
        END IF;
        seen_fields := array_append(seen_fields, field);
    END LOOP;
    RETURN TRUE;
END;
$$;

CREATE TABLE site_capability_configurations (
    site_id VARCHAR(64) PRIMARY KEY CHECK (length(site_id) > 0),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    document JSONB NOT NULL,
    CONSTRAINT site_capability_configurations_document_check CHECK (
        jsonb_typeof(document) = 'object'
        AND document ?& ARRAY['schema_version', 'site_id', 'version', 'updated_at', 'capabilities', 'consent_policy', 'privacy_constraints']
        AND jsonb_typeof(document->'schema_version') = 'number'
        AND (document->>'schema_version')::NUMERIC = 1
        AND jsonb_typeof(document->'site_id') = 'string'
        AND document->>'site_id' = site_id
        AND jsonb_typeof(document->'version') = 'number'
        AND trunc((document->>'version')::NUMERIC) = (document->>'version')::NUMERIC
        AND (document->>'version')::NUMERIC = version
        AND jsonb_typeof(document->'updated_at') = 'string'
        AND configuration_datetime_is_valid(document->>'updated_at')
        AND (document->>'updated_at')::TIMESTAMPTZ = updated_at
        AND (document - ARRAY['schema_version', 'site_id', 'version', 'updated_at', 'capabilities', 'consent_policy', 'privacy_constraints']) = '{}'::jsonb
        AND configuration_capabilities_document_is_valid(document->'capabilities')
        AND document->>'consent_policy' = 'required'
        AND document->'privacy_constraints' = '["no_ip_persistence", "no_fingerprinting", "consent_required"]'::jsonb
    )
);

CREATE TABLE site_environment_policies (
    site_id VARCHAR(64) NOT NULL,
    environment TEXT NOT NULL CHECK (length(btrim(environment)) > 0),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    document JSONB NOT NULL,
    PRIMARY KEY (site_id, environment),
    CONSTRAINT site_environment_policies_document_check CHECK (
        jsonb_typeof(document) = 'object'
        AND document ?& ARRAY['schema_version', 'site_id', 'environment', 'version', 'updated_at', 'enabled', 'allowed_origins', 'ingest_keys', 'rate_limit_per_minute']
        AND jsonb_typeof(document->'schema_version') = 'number'
        AND (document->>'schema_version')::NUMERIC = 1
        AND jsonb_typeof(document->'site_id') = 'string'
        AND document->>'site_id' = site_id
        AND jsonb_typeof(document->'environment') = 'string'
        AND document->>'environment' = environment
        AND jsonb_typeof(document->'version') = 'number'
        AND trunc((document->>'version')::NUMERIC) = (document->>'version')::NUMERIC
        AND (document->>'version')::NUMERIC = version
        AND (document->>'updated_at')::TIMESTAMPTZ = updated_at
        AND configuration_environment_policy_document_is_valid(document)
    )
);

CREATE FUNCTION enforce_site_environment_origin_uniqueness()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    candidate_origin TEXT;
    existing_origin TEXT;
    locked_site_id TEXT;
BEGIN
    -- Serialize writes for every affected site. Lock IDs in stable order so
    -- concurrent identity moves cannot claim an Origin in either site.
    IF TG_OP = 'UPDATE' AND OLD.site_id IS DISTINCT FROM NEW.site_id THEN
        FOR locked_site_id IN
            SELECT DISTINCT site_id
              FROM unnest(ARRAY[OLD.site_id, NEW.site_id]) AS sites(site_id)
             ORDER BY site_id
        LOOP
            PERFORM pg_advisory_xact_lock(hashtextextended(locked_site_id, 0));
        END LOOP;
    ELSE
        PERFORM pg_advisory_xact_lock(hashtextextended(NEW.site_id, 0));
    END IF;

    FOR candidate_origin IN
        SELECT jsonb_array_elements_text(NEW.document->'allowed_origins')
    LOOP
        FOR existing_origin IN
            SELECT jsonb_array_elements_text(policy.document->'allowed_origins')
              FROM site_environment_policies AS policy
             WHERE policy.site_id = NEW.site_id
               AND policy.environment <> NEW.environment
               AND NOT (TG_OP = 'UPDATE' AND policy.site_id = OLD.site_id AND policy.environment = OLD.environment)
        LOOP
            IF configuration_normalize_origin(candidate_origin)
               = configuration_normalize_origin(existing_origin) THEN
                RAISE EXCEPTION 'Origin is already assigned to another environment for this site'
                    USING ERRCODE = '23505', CONSTRAINT = 'site_environment_origin_unique';
            END IF;
        END LOOP;
    END LOOP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER site_environment_origin_uniqueness
BEFORE INSERT OR UPDATE ON site_environment_policies
FOR EACH ROW EXECUTE FUNCTION enforce_site_environment_origin_uniqueness();

CREATE TABLE configuration_audit (
    audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_kind TEXT NOT NULL CHECK (actor_kind = 'deployment_admin'),
    resource JSONB NOT NULL,
    version BIGINT NOT NULL CHECK (version >= 1),
    operation TEXT NOT NULL CHECK (operation IN ('created', 'updated', 'revoked')),
    changed_fields TEXT[] NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT configuration_audit_resource_check CHECK (
        jsonb_typeof(resource) = 'object'
        AND resource ?& ARRAY['kind', 'site_id']
        AND resource->>'kind' IN ('site_capabilities', 'environment_policy', 'ingest_key')
        AND jsonb_typeof(resource->'site_id') = 'string'
        AND length(resource->>'site_id') > 0
        AND (resource - ARRAY['kind', 'site_id', 'environment', 'key_id']) = '{}'::jsonb
        AND (
            (resource->>'kind' = 'site_capabilities' AND NOT (resource ? 'environment') AND NOT (resource ? 'key_id'))
            OR (resource->>'kind' = 'environment_policy' AND jsonb_typeof(resource->'environment') = 'string' AND length(resource->>'environment') > 0 AND NOT (resource ? 'key_id'))
            OR (resource->>'kind' = 'ingest_key' AND jsonb_typeof(resource->'environment') = 'string' AND length(resource->>'environment') > 0 AND jsonb_typeof(resource->'key_id') = 'string' AND resource->>'key_id' ~ '^ik_[A-Za-z0-9_-]{8,64}$')
        )
    ),
    CONSTRAINT configuration_audit_changed_fields_check CHECK (
        configuration_text_array_is_unique(changed_fields)
        AND changed_fields <@ ARRAY[
            'capabilities', 'environment.enabled', 'environment.allowed_origins',
            'environment.rate_limit_per_minute', 'environment.ingest_keys'
        ]::TEXT[]
    ),
    CONSTRAINT configuration_audit_retention_check CHECK (expires_at = created_at + INTERVAL '1 year')
);

CREATE INDEX configuration_audit_expiry_idx ON configuration_audit (expires_at);

INSERT INTO site_capability_configurations (site_id, version, updated_at, document)
SELECT
    flags.site_id,
    1,
    NOW(),
    jsonb_build_object(
        'schema_version', 1,
        'site_id', flags.site_id,
        'version', 1,
        'updated_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'capabilities', jsonb_build_object(
            'page_views', jsonb_build_object('enabled', true, 'settings', '{}'::jsonb),
            'browser_context', jsonb_build_object('enabled', flags.analytics_enabled, 'settings', '{}'::jsonb),
            'anonymous_visitors', jsonb_build_object('enabled', flags.analytics_enabled, 'settings', '{}'::jsonb),
            'sessions', jsonb_build_object('enabled', flags.analytics_enabled, 'settings', '{}'::jsonb),
            'dimensions', jsonb_build_object('enabled', flags.analytics_enabled, 'settings', '{}'::jsonb),
            'custom_events', jsonb_build_object('enabled', true, 'settings', '{}'::jsonb),
            'web_vitals', jsonb_build_object('enabled', true, 'settings', '{}'::jsonb),
            'conversions', jsonb_build_object('enabled', true, 'settings', '{}'::jsonb),
            'funnels', jsonb_build_object('enabled', true, 'settings', '{}'::jsonb),
            'geo', jsonb_build_object('enabled', true, 'settings', '{}'::jsonb)
        ),
        'consent_policy', 'required',
        'privacy_constraints', jsonb_build_array('no_ip_persistence', 'no_fingerprinting', 'consent_required')
    )
FROM analytics_feature_flags AS flags;
