use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};

mod applied_state;
mod capabilities;
mod definition_revisions;
mod environment_policies;

pub(crate) use applied_state::{
    AppliedCapabilityState, AppliedCollectorState, capability_applied_state,
    collector_applied_state,
};
pub(crate) use capabilities::{create_capabilities, get_capabilities, update_capabilities};
pub(crate) use definition_revisions::{
    create_definition_set, get_current_definition_set, update_definition_set,
};
pub(crate) use environment_policies::{
    create_ingest_key, create_ingest_policy, get_ingest_policy, revoke_ingest_key,
    update_ingest_policy,
};

#[derive(Debug, Clone)]
pub(crate) struct ConfigurationRow {
    pub(crate) version: i64,
    pub(crate) document: Value,
}

#[derive(Debug)]
pub(crate) enum StoreError {
    NotFound,
    Conflict,
    AlreadyExists,
    DefinitionRemoval,
    OriginConflict,
    Database(sqlx::Error),
}

fn map_database_error(error: sqlx::Error) -> StoreError {
    if let Some(database) = error.as_database_error()
        && database.code().as_deref() == Some("23505")
    {
        match database.constraint() {
            Some("site_environment_origin_unique") => return StoreError::OriginConflict,
            Some("site_environment_policies_pkey") => return StoreError::AlreadyExists,
            Some("site_capability_configurations_pkey") => return StoreError::AlreadyExists,
            _ => {}
        }
    }
    StoreError::Database(error)
}

async fn write_audit(
    transaction: &mut Transaction<'_, Postgres>,
    resource: Value,
    version: i64,
    operation: &'static str,
    changed_fields: Vec<String>,
) -> Result<(), StoreError> {
    sqlx::query(
        "INSERT INTO configuration_audit
            (actor_kind, resource, version, operation, changed_fields, created_at, expires_at)
         VALUES ('deployment_admin', $1, $2, $3, $4, NOW(), NOW() + INTERVAL '1 year')",
    )
    .bind(resource)
    .bind(version)
    .bind(operation)
    .bind(changed_fields)
    .execute(&mut **transaction)
    .await
    .map_err(map_database_error)?;
    Ok(())
}

fn set_version_and_time(document: &mut Value, version: i64, updated_at: DateTime<Utc>) {
    document["version"] = json!(version);
    document["updated_at"] = json!(updated_at.to_rfc3339_opts(SecondsFormat::Micros, true));
}

fn replace_capabilities(
    document: &mut Value,
    capabilities: Value,
    version: i64,
    updated_at: DateTime<Utc>,
) {
    document["capabilities"] = capabilities;
    set_version_and_time(document, version, updated_at);
}

fn append_ingest_key(
    document: &mut Value,
    key_id: &str,
    digest: &str,
    created_at: DateTime<Utc>,
) -> bool {
    let mut keys = document["ingest_keys"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if keys
        .iter()
        .any(|key| key["key_id"].as_str() == Some(key_id))
    {
        return false;
    }
    keys.push(json!({
        "key_id": key_id,
        "sha256_digest": digest,
        "created_at": created_at.to_rfc3339_opts(SecondsFormat::Micros, true),
    }));
    document["ingest_keys"] = json!(keys);
    true
}

async fn next_version_and_time(
    transaction: &mut Transaction<'_, Postgres>,
    current: i64,
) -> Result<(i64, DateTime<Utc>), StoreError> {
    let version = current.checked_add(1).ok_or(StoreError::Conflict)?;
    let updated_at = sqlx::query_scalar::<_, DateTime<Utc>>("SELECT NOW()")
        .fetch_one(&mut **transaction)
        .await
        .map_err(map_database_error)?;
    Ok((version, updated_at))
}

#[cfg(test)]
mod serialization_schema_tests {
    use chrono::{TimeZone, Utc};
    use serde_json::Value;

    fn schema(name: &str) -> jsonschema::Validator {
        let text = match name {
            "environment-policy.schema.json" => include_str!(
                "../../../../protocol/contracts/configuration/current/environment-policy.schema.json"
            ),
            "capabilities.schema.json" => include_str!(
                "../../../../protocol/contracts/configuration/current/capabilities.schema.json"
            ),
            "conversion-funnel-definition-set-update.schema.json" => include_str!(
                "../../../../protocol/contracts/configuration/current/conversion-funnel-definition-set-update.schema.json"
            ),
            _ => unreachable!(),
        };
        let document: Value = serde_json::from_str(text).unwrap();
        jsonschema::options()
            .with_draft(jsonschema::Draft::Draft202012)
            .should_validate_formats(true)
            .build(&document)
            .unwrap()
    }

    #[test]
    fn policy_and_capability_write_documents_serialize_to_their_stored_schemas() {
        let at = Utc.with_ymd_and_hms(2026, 9, 30, 12, 0, 0).unwrap();
        let policy: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/environment-policy/valid/production.json"
        )).unwrap();
        let mut policy = super::environment_policies::ingest_policy_document(
            policy["site_id"].as_str().unwrap(),
            policy["environment"].as_str().unwrap(),
            policy["enabled"].as_bool().unwrap(),
            policy["allowed_origins"].clone(),
            policy["rate_limit_per_minute"].as_i64().unwrap(),
            at,
        );
        assert!(super::append_ingest_key(
            &mut policy,
            "ik_12345678",
            &"a".repeat(64),
            at,
        ));
        super::set_version_and_time(&mut policy, 3, at);
        let policy_round_trip: Value =
            serde_json::from_str(&serde_json::to_string(&policy).unwrap()).unwrap();
        assert!(
            schema("environment-policy.schema.json")
                .validate(&policy_round_trip)
                .is_ok()
        );

        let mut capabilities: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/capabilities/valid/legacy-enabled.json"
        )).unwrap();
        let update: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/capability-update/valid/all-enabled.json"
        )).unwrap();
        super::replace_capabilities(&mut capabilities, update["capabilities"].clone(), 2, at);
        let round_trip: Value =
            serde_json::from_str(&serde_json::to_string(&capabilities).unwrap()).unwrap();
        assert!(
            schema("capabilities.schema.json")
                .validate(&round_trip)
                .is_ok()
        );
    }

    #[test]
    fn definition_revision_serialization_preserves_validated_contract_and_server_metadata() {
        let update: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/conversion-funnel-definition-set-update/valid/definitions.json"
        )).unwrap();
        let update_schema = schema("conversion-funnel-definition-set-update.schema.json");
        assert!(update_schema.validate(&update).is_ok());
        let at = Utc.with_ymd_and_hms(2026, 9, 30, 12, 0, 0).unwrap();
        let stored = super::definition_revisions::definition_document(
            "site_example",
            4,
            "revision-4",
            at,
            Some(at),
            update,
        );
        let round_trip: Value =
            serde_json::from_str(&serde_json::to_string(&stored).unwrap()).unwrap();
        assert_eq!(round_trip["schema_version"], 1);
        assert_eq!(round_trip["site_id"], "site_example");
        assert_eq!(round_trip["revision"], 4);
        assert_eq!(round_trip["updated_at"], "2026-09-30T12:00:00.000000Z");
        assert!(
            update_schema
                .validate(&serde_json::json!({
                    "conversions": round_trip["conversions"],
                    "funnels": round_trip["funnels"]
                }))
                .is_ok()
        );
    }
}
