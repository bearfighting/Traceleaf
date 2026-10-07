use super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AppliedCollectorState {
    pub(crate) status: &'static str,
    pub(crate) applied_version: Option<i64>,
}

pub(crate) async fn collector_applied_state(
    pool: &PgPool,
    site_id: &str,
    environment: &str,
    stored_version: i64,
) -> Result<AppliedCollectorState, StoreError> {
    let active = sqlx::query_as::<_, (String, String, Option<i64>, Option<String>)>(
        "SELECT instances.instance_id, instances.refresh_status, state.applied_version, state.refresh_status FROM configuration_runtime_instances AS instances LEFT JOIN configuration_runtime_state AS state ON state.instance_id = instances.instance_id AND state.service = 'collector' AND state.site_id = $1 AND state.environment = $2 WHERE instances.service = 'collector' AND instances.last_seen_at >= NOW() - INTERVAL '15 seconds'",
    )
    .bind(site_id)
    .bind(environment)
    .fetch_all(pool)
    .await
    .map_err(map_database_error)?;

    if !active.is_empty() {
        let stale = active.iter().any(|(_, instance_status, _, policy_status)| {
            instance_status == "stale" || policy_status.as_deref() == Some("stale")
        });
        let missing_version = active
            .iter()
            .any(|(_, _, version, policy_status)| version.is_none() || policy_status.is_none());
        let applied_version = active
            .iter()
            .filter_map(|(_, _, version, _)| *version)
            .min();

        if stale {
            return Ok(AppliedCollectorState {
                status: "stale",
                applied_version: if missing_version {
                    None
                } else {
                    applied_version
                },
            });
        }
        if missing_version {
            return Ok(AppliedCollectorState {
                status: "pending",
                applied_version: None,
            });
        }
        let status = if applied_version.is_some_and(|version| version >= stored_version) {
            "current"
        } else {
            "pending"
        };
        return Ok(AppliedCollectorState {
            status,
            applied_version,
        });
    }

    let history = sqlx::query_as::<_, (Option<i64>,)>(
        "SELECT applied_version FROM configuration_runtime_state WHERE service = 'collector' AND site_id = $1 AND environment = $2",
    )
    .bind(site_id)
    .bind(environment)
    .fetch_all(pool)
    .await
    .map_err(map_database_error)?;
    if history.is_empty() {
        return Ok(AppliedCollectorState {
            status: "pending",
            applied_version: None,
        });
    }
    let missing_version = history.iter().any(|(version,)| version.is_none());
    let applied_version = history.iter().filter_map(|(version,)| *version).min();
    Ok(AppliedCollectorState {
        status: "stale",
        applied_version: if missing_version {
            None
        } else {
            applied_version
        },
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AppliedCapabilityState {
    pub(crate) status: &'static str,
    pub(crate) applied_version: Option<i64>,
}

pub(crate) async fn capability_applied_state(
    pool: &PgPool,
    service: &str,
    site_id: &str,
    stored_version: i64,
) -> Result<AppliedCapabilityState, StoreError> {
    let active = sqlx::query_as::<_, (String, String, Option<i64>, Option<String>)>(
        "SELECT instances.instance_id, instances.refresh_status, state.applied_version, state.refresh_status
         FROM configuration_capability_runtime_instances AS instances
         LEFT JOIN configuration_capability_runtime_state AS state
           ON state.service = instances.service AND state.instance_id = instances.instance_id AND state.site_id = $2
         WHERE instances.service = $1 AND instances.last_seen_at >= NOW() - INTERVAL '15 seconds'",
    ).bind(service).bind(site_id).fetch_all(pool).await.map_err(map_database_error)?;

    if !active.is_empty() {
        let stale = active.iter().any(|(_, instance_status, _, report_status)| {
            instance_status == "stale" || report_status.as_deref() == Some("stale")
        });
        let missing = active
            .iter()
            .any(|(_, _, version, report_status)| version.is_none() || report_status.is_none());
        let applied_version = active
            .iter()
            .filter_map(|(_, _, version, _)| *version)
            .min();
        if stale {
            return Ok(AppliedCapabilityState {
                status: "stale",
                applied_version: if missing { None } else { applied_version },
            });
        }
        if missing {
            return Ok(AppliedCapabilityState {
                status: "pending",
                applied_version: None,
            });
        }
        return Ok(AppliedCapabilityState {
            status: if applied_version.is_some_and(|version| version >= stored_version) {
                "current"
            } else {
                "pending"
            },
            applied_version,
        });
    }

    let history = sqlx::query_as::<_, (Option<i64>,)>(
        "SELECT applied_version FROM configuration_capability_runtime_state WHERE service = $1 AND site_id = $2",
    ).bind(service).bind(site_id).fetch_all(pool).await.map_err(map_database_error)?;
    if history.is_empty() {
        return Ok(AppliedCapabilityState {
            status: "pending",
            applied_version: None,
        });
    }
    let missing = history.iter().any(|(version,)| version.is_none());
    Ok(AppliedCapabilityState {
        status: "stale",
        applied_version: if missing {
            None
        } else {
            history.iter().filter_map(|(version,)| *version).min()
        },
    })
}
