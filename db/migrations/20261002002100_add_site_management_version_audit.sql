ALTER TABLE site_registry
    ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1);

CREATE TABLE site_management_audit (
    audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site_id VARCHAR(64) NOT NULL REFERENCES site_registry(site_id) ON DELETE RESTRICT,
    actor_kind TEXT NOT NULL CHECK (actor_kind = 'deployment_admin'),
    site_version BIGINT NOT NULL CHECK (site_version >= 1),
    operation TEXT NOT NULL CHECK (operation IN ('created', 'metadata_updated', 'archived', 'restored')),
    changed_fields TEXT[] NOT NULL CHECK (array_position(changed_fields, NULL) IS NULL),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX site_management_audit_site_created_idx
    ON site_management_audit(site_id, created_at);

COMMENT ON TABLE site_management_audit IS
    'Append-only Site lifecycle and metadata audit retained for the Site lifetime.';

CREATE FUNCTION reject_site_management_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'site_management_audit is append-only';
END;
$$;

CREATE TRIGGER site_management_audit_append_only
    BEFORE UPDATE OR DELETE ON site_management_audit
    FOR EACH ROW EXECUTE FUNCTION reject_site_management_audit_mutation();
