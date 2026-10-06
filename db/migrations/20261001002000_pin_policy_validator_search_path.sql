-- Policy validation is invoked while pg_restore runs with an empty session
-- search_path. Pin the schema lookup for the validator's PL/pgSQL helper calls
-- so backups can be restored without relying on the caller's search_path.
ALTER FUNCTION public.configuration_environment_policy_document_is_valid(JSONB)
    SET search_path = pg_catalog, public;
