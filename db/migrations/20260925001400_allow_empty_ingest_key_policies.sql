-- An environment may be provisioned before its first public ingest key is issued.
-- Such a policy remains fail-closed until a key is created.
CREATE OR REPLACE FUNCTION configuration_environment_policy_document_is_valid(value JSONB)
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

