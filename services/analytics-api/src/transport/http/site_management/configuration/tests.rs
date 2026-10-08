#[cfg(test)]
mod validator_tests {
    pub(super) use axum::response::IntoResponse;
    pub(super) use serde_json::Value;

    pub(super) use crate::{
        application::site_management_validation::ConfigurationValidators,
        site_management::errors::ConfigurationApiError,
        transport::http::site_management::configuration::{
            validate_capability_dependencies, validate_definition_set, validate_policy_origins,
            validate_schema, validate_stored_capabilities, validate_stored_definition_set,
            validate_stored_policy,
        },
    };

    mod stored_document_validation {
        use super::*;

        #[tokio::test]
        async fn invalid_stored_documents_map_to_unavailable_before_get_response_projection() {
            use crate::{
                application::site_management::ConfigurationDocument as ConfigurationRow,
                application::site_management_state::SiteManagementState,
            };
            use sqlx::postgres::PgPoolOptions;

            let pool = PgPoolOptions::new()
                .connect_lazy("postgres://analytics:analytics@127.0.0.1:1/analytics")
                .unwrap();
            let state = SiteManagementState::new(
                std::sync::Arc::new(
                    crate::storage::postgres::PostgresSiteManagementAdapter::new(pool),
                ),
                std::sync::Arc::new(
                    configuration_runtime::CapabilityRegistry::canonical().unwrap(),
                ),
            )
            .unwrap();
            let policy = ConfigurationRow {
                version: 1,
                document: serde_json::json!({"site_id":"site_a","environment":"production","version":1,"unexpected":true}),
            };
            assert!(matches!(
                validate_stored_policy(&policy, &state, "site_a", "production"),
                Err(super::ConfigurationApiError::Unavailable)
            ));
            let capabilities = ConfigurationRow {
                version: 1,
                document: serde_json::json!({"site_id":"site_a","version":1,"unexpected":true}),
            };
            assert!(matches!(
                validate_stored_capabilities(&capabilities, &state, "site_a"),
                Err(super::ConfigurationApiError::Unavailable)
            ));
            let definitions = ConfigurationRow {
                version: 1,
                document: serde_json::json!({"site_id":"site_a","revision":1,"definition_version":"r1-token","unexpected":true}),
            };
            assert!(matches!(
                validate_stored_definition_set(&definitions, &state, "site_a"),
                Err(super::ConfigurationApiError::Unavailable)
            ));
        }
    }

    mod capability_validation {
        use super::*;

        #[test]
        fn management_updates_reject_enabled_planned_capabilities() {
            let mut manifest: Value = serde_json::from_str(include_str!(
                "../../../../../../../protocol/capabilities/capabilities.json"
            ))
            .unwrap();
            let geo = manifest["capabilities"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|entry| entry["id"] == "geo")
                .unwrap();
            geo["status"] = serde_json::json!("planned");
            geo["api"]["query_surface"] = serde_json::json!("future_report");
            geo["api"]["routes"] = serde_json::json!([]);
            geo["dashboard"]["surface"] = serde_json::json!("future_report");
            let registry =
                configuration_runtime::CapabilityRegistry::from_json(&manifest.to_string())
                    .unwrap();
            let value: Value = serde_json::from_str(include_str!("../../../../../../../protocol/contracts/configuration/current/fixtures/capability-update/valid/all-enabled.json")).unwrap();
            assert!(matches!(
                super::validate_capability_dependencies(&value, &registry),
                Err(super::ConfigurationApiError::Validation(_))
            ));
        }
    }

    mod fixture_contract_validation {
        use super::*;

        #[test]
        fn canonical_update_fixtures_match_management_schema_boundaries() {
            let validators = ConfigurationValidators::new().unwrap();
            let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../protocol/contracts/configuration/current/fixtures");
            let cases = [
                ("environment-policy-update", &validators.environment_policy),
                ("capability-update", &validators.capabilities),
                (
                    "conversion-funnel-definition-set-update",
                    &validators.definition_set,
                ),
            ];
            for (fixture_name, validator) in cases {
                for (kind, expected) in [("valid", true), ("invalid", false)] {
                    let directory = root.join(fixture_name).join(kind);
                    for entry in std::fs::read_dir(directory).unwrap() {
                        let path = entry.unwrap().path();
                        if path.extension().and_then(|extension| extension.to_str()) != Some("json")
                        {
                            continue;
                        }
                        let value: Value =
                            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
                        let schema_accepts = validate_schema(validator, &value, "").is_ok();
                        let filename = path.file_name().unwrap().to_string_lossy();
                        let semantic = matches!(
                            (fixture_name, filename.as_ref()),
                            (
                                "conversion-funnel-definition-set-update",
                                "duplicate-ids.json"
                            )
                        );
                        assert_eq!(schema_accepts, expected || semantic, "{}", path.display());
                        let service_accepts = if !schema_accepts {
                            None
                        } else {
                            Some(match fixture_name {
                                "environment-policy-update" => value["allowed_origins"]
                                    .as_array()
                                    .map(|origins| {
                                        let origins = origins
                                            .iter()
                                            .filter_map(Value::as_str)
                                            .map(str::to_owned)
                                            .collect::<Vec<_>>();
                                        super::validate_policy_origins(&origins).is_ok()
                                    })
                                    .unwrap_or(false),
                                "capability-update" => super::validate_capability_dependencies(
                                    &value,
                                    &configuration_runtime::CapabilityRegistry::canonical()
                                        .unwrap(),
                                )
                                .is_ok(),
                                "conversion-funnel-definition-set-update" => {
                                    super::validate_definition_set(&value).is_ok()
                                }
                                _ => unreachable!(),
                            })
                        };
                        assert_eq!(
                            service_accepts,
                            schema_accepts.then_some(!semantic),
                            "{}",
                            path.display()
                        );
                        println!(
                            "M24_FIXTURE_RESULT\t{fixture_name}/{kind}/{filename}\tschema={}\tservice={}",
                            if schema_accepts { "accept" } else { "reject" },
                            match service_accepts {
                                Some(true) => "accept",
                                Some(false) => "reject",
                                None => "not-reached",
                            }
                        );
                    }
                }
            }
        }

        #[tokio::test]
        async fn injected_management_validators_preserve_schema_error_responses() {
            let validators = ConfigurationValidators::new().unwrap();
            let cases = [
                (
                    &validators.capabilities,
                    include_str!(
                        "../../../../../../../protocol/contracts/configuration/current/fixtures/capability-update/valid/all-enabled.json"
                    ),
                    include_str!(
                        "../../../../../../../protocol/contracts/configuration/current/fixtures/capability-update/invalid/unknown-capability.json"
                    ),
                ),
                (
                    &validators.environment_policy,
                    include_str!(
                        "../../../../../../../protocol/contracts/configuration/current/fixtures/environment-policy-update/valid/production.json"
                    ),
                    include_str!(
                        "../../../../../../../protocol/contracts/configuration/current/fixtures/environment-policy-update/invalid/duplicate-origins.json"
                    ),
                ),
                (
                    &validators.definition_set,
                    include_str!(
                        "../../../../../../../protocol/contracts/configuration/current/fixtures/conversion-funnel-definition-set-update/valid/definitions.json"
                    ),
                    include_str!(
                        "../../../../../../../protocol/contracts/configuration/current/fixtures/conversion-funnel-definition-set-update/invalid/missing-active.json"
                    ),
                ),
            ];

            for (validator, valid, invalid) in cases {
                let valid: Value = serde_json::from_str(valid).unwrap();
                assert!(validate_schema(validator, &valid, "").is_ok());

                let invalid: Value = serde_json::from_str(invalid).unwrap();
                let error = validate_schema(validator, &invalid, "").unwrap_err();
                let response = error.into_response();
                assert_eq!(
                    response.status(),
                    axum::http::StatusCode::UNPROCESSABLE_ENTITY
                );
                let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                    .await
                    .unwrap();
                let body: Value = serde_json::from_slice(&bytes).unwrap();
                assert_eq!(body["error"]["code"], "configuration_validation_failed");
                assert_eq!(body["error"]["message"], "Configuration failed validation.");
                assert_eq!(body["error"]["details"][0]["code"], "schema_validation");
                assert_eq!(
                    body["error"]["details"][0]["message"],
                    "Value does not match the configuration schema."
                );
            }
        }
    }

    mod semantic_validation {
        use super::*;

        #[tokio::test]
        async fn canonical_semantic_fixtures_preserve_service_rules_and_error_mapping() {
            let validators = ConfigurationValidators::new().unwrap();
            let mut capability: Value = serde_json::from_str(include_str!(
                "../../../../../../../protocol/contracts/configuration/current/fixtures/capability-update/valid/all-enabled.json"
            )).unwrap();
            capability["capabilities"]["anonymous_visitors"]["enabled"] = serde_json::json!(false);
            assert!(validate_schema(&validators.capabilities, &capability, "").is_ok());
            let dependency_error = super::validate_capability_dependencies(
                &capability,
                &configuration_runtime::CapabilityRegistry::canonical().unwrap(),
            )
            .unwrap_err();
            let dependency_response = dependency_error.into_response();
            assert_eq!(
                dependency_response.status(),
                axum::http::StatusCode::UNPROCESSABLE_ENTITY
            );
            let dependency_body = axum::body::to_bytes(dependency_response.into_body(), usize::MAX)
                .await
                .unwrap();
            let dependency_body: Value = serde_json::from_slice(&dependency_body).unwrap();
            assert_eq!(
                dependency_body["error"]["code"],
                "configuration_validation_failed"
            );
            assert_eq!(
                dependency_body["error"]["details"][0]["code"],
                "missing_dependency"
            );
            capability["capabilities"]["browser_context"]["enabled"] = serde_json::json!(true);
            capability["capabilities"]["sessions"]["enabled"] = serde_json::json!(false);
            assert!(
                super::validate_capability_dependencies(
                    &capability,
                    &configuration_runtime::CapabilityRegistry::canonical().unwrap()
                )
                .is_ok()
            );

            let mut policy_update: Value = serde_json::from_str(include_str!(
                "../../../../../../../protocol/contracts/configuration/current/fixtures/environment-policy-update/valid/production.json"
            ))
            .unwrap();
            policy_update["allowed_origins"] =
                serde_json::json!(["https://example.com:443/", "https://example.com"]);
            assert!(validate_schema(&validators.environment_policy, &policy_update, "").is_ok());
            let origins = policy_update["allowed_origins"]
                .as_array()
                .unwrap()
                .iter()
                .map(|origin| origin.as_str().unwrap().to_owned())
                .collect::<Vec<_>>();
            let origin_error = super::validate_policy_origins(&origins).unwrap_err();
            match origin_error {
                crate::site_management::errors::ConfigurationApiError::Validation(details) => {
                    assert_eq!(details[0].code, "duplicate_origin")
                }
                other => panic!("expected duplicate origin validation error, got {other:?}"),
            }

            let duplicate_ids: Value = serde_json::from_str(include_str!(
                "../../../../../../../protocol/contracts/configuration/current/fixtures/conversion-funnel-definition-set-update/invalid/duplicate-ids.json"
            )).unwrap();
            assert!(validate_schema(&validators.definition_set, &duplicate_ids, "").is_ok());
            let duplicate_error = super::validate_definition_set(&duplicate_ids).unwrap_err();
            match duplicate_error {
                crate::site_management::errors::ConfigurationApiError::Validation(details) => {
                    assert_eq!(details[0].code, "duplicate_definition_id")
                }
                other => panic!("expected duplicate ID validation error, got {other:?}"),
            }

            let mut sensitive: Value = serde_json::from_str(include_str!(
                "../../../../../../../protocol/contracts/configuration/current/fixtures/conversion-funnel-definition-set-update/valid/definitions.json"
            )).unwrap();
            sensitive["conversions"][0]["properties"] =
                serde_json::json!({"email": "person@example.com"});
            assert!(validate_schema(&validators.definition_set, &sensitive, "").is_ok());
            let privacy_error = super::validate_definition_set(&sensitive).unwrap_err();
            match privacy_error {
                crate::site_management::errors::ConfigurationApiError::Validation(details) => {
                    assert_eq!(details[0].code, "sensitive_property_forbidden")
                }
                other => panic!("expected privacy validation error, got {other:?}"),
            }
        }
    }
}
