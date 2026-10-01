CREATE TABLE site_creation_requests (
    idempotency_key VARCHAR(128) PRIMARY KEY
        CHECK (length(idempotency_key) BETWEEN 1 AND 128)
        CHECK (idempotency_key ~ '^[!-~]+$'),
    request_digest CHAR(64) NOT NULL
        CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    site_id VARCHAR(64) NOT NULL UNIQUE
        REFERENCES site_registry(site_id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE site_creation_requests IS
    'Permanent idempotency association for Site creation; retained for the Site lifetime, including archive.';

CREATE FUNCTION reject_site_creation_request_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'site_creation_requests is immutable';
END;
$$;

CREATE TRIGGER site_creation_requests_immutable
    BEFORE UPDATE OR DELETE ON site_creation_requests
    FOR EACH ROW EXECUTE FUNCTION reject_site_creation_request_mutation();
