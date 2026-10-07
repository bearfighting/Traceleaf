//! Generation record lifecycle operations.

use chrono::NaiveDate;
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

pub(crate) async fn load_active_generation(
    connection: &mut PgConnection,
    site_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT generation_id::text FROM analytics_generations WHERE site_id=$1 AND status='active' FOR UPDATE")
        .bind(site_id)
        .fetch_optional(&mut *connection)
        .await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_building_generation(
    connection: &mut PgConnection,
    generation_id: &str,
    site_id: &str,
    aggregation_version: i32,
    parser_version: &str,
    scope_from: NaiveDate,
    scope_to: NaiveDate,
    reason: &str,
    source_watermark: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO analytics_generations (generation_id,site_id,aggregation_version,parser_version,scope_from,scope_to,rebuild_reason,status,source_watermark) VALUES($1::uuid,$2,$3,$4,$5,$6,$7,'building',$8)")
        .bind(generation_id)
        .bind(site_id)
        .bind(aggregation_version)
        .bind(parser_version)
        .bind(scope_from)
        .bind(scope_to)
        .bind(reason)
        .bind(source_watermark)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_failed_generation(
    pool: &PgPool,
    generation_id: &str,
    site_id: &str,
    aggregation_version: i32,
    parser_version: &str,
    scope_from: NaiveDate,
    scope_to: NaiveDate,
    reason: &str,
    failure_reason: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO analytics_generations (generation_id,site_id,aggregation_version,parser_version,scope_from,scope_to,rebuild_reason,status,failure_reason) VALUES($1::uuid,$2,$3,$4,$5,$6,$7,'failed',$8) ON CONFLICT(generation_id) DO NOTHING")
        .bind(generation_id)
        .bind(site_id)
        .bind(aggregation_version)
        .bind(parser_version)
        .bind(scope_from)
        .bind(scope_to)
        .bind(reason)
        .bind(failure_reason)
        .execute(pool)
        .await?;
    Ok(())
}

pub(crate) async fn retire_generation(
    connection: &mut PgConnection,
    site_id: &str,
    generation_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE analytics_generations SET status='retired' WHERE site_id=$1 AND generation_id=$2::uuid")
        .bind(site_id)
        .bind(generation_id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

pub(crate) async fn activate_generation(
    connection: &mut PgConnection,
    generation_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE analytics_generations SET status='active',activated_at=NOW() WHERE generation_id=$1::uuid")
        .bind(generation_id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

pub(crate) async fn rollback_target_status(
    connection: &mut PgConnection,
    site_id: &str,
    generation_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT status FROM analytics_generations WHERE site_id=$1 AND generation_id=$2::uuid FOR UPDATE")
        .bind(site_id)
        .bind(generation_id)
        .fetch_optional(&mut *connection)
        .await
}

pub(crate) async fn restore_retired_generation(
    connection: &mut PgConnection,
    site_id: &str,
    generation_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE analytics_generations SET status='active',activated_at=NOW(),failure_reason=NULL WHERE site_id=$1 AND generation_id=$2::uuid AND status='retired'")
        .bind(site_id)
        .bind(generation_id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

pub(crate) async fn retire_active_generation(
    connection: &mut PgConnection,
    site_id: &str,
    generation_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE analytics_generations SET status='retired' WHERE site_id=$1 AND generation_id=$2::uuid AND status='active'")
        .bind(site_id)
        .bind(generation_id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}
