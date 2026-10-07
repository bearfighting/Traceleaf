use super::*;

fn digest_hex(key: &str) -> String {
    let digest = Sha256::digest(key.as_bytes());
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

fn create_key_material()
-> Result<(String, String, String, chrono::DateTime<Utc>), ConfigurationApiError> {
    let mut key_bytes = [0_u8; 32];
    let mut id_bytes = [0_u8; 12];
    random_fill(&mut key_bytes).map_err(|_| ConfigurationApiError::Unavailable)?;
    random_fill(&mut id_bytes).map_err(|_| ConfigurationApiError::Unavailable)?;
    let key = URL_SAFE_NO_PAD.encode(key_bytes);
    let key_id = format!("ik_{}", URL_SAFE_NO_PAD.encode(id_bytes));
    let digest = digest_hex(&key);
    Ok((key, key_id, digest, Utc::now()))
}

pub(in crate::site_management) async fn create_ingest_key(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path((site_id, environment)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Response, ConfigurationApiError> {
    validate_identity(&site_id, Some(&environment))?;
    let version = parse_if_match(&headers)?;
    let (key, key_id, digest, created_at) = create_key_material()?;
    let row = config_store::create_ingest_key(
        &state.pool,
        &site_id,
        &environment,
        version,
        &key_id,
        &digest,
        created_at,
    )
    .await
    .map_err(map_store_error)?;
    let metadata = json!({
        "key_id": key_id,
        "created_at": created_at.to_rfc3339_opts(SecondsFormat::Micros, true),
    });
    let body = json!({
        "key": key,
        "metadata": metadata,
        "effective_state": policy_effective_state(&state.pool, &row).await,
    });
    let mut response = response_with_etag(StatusCode::CREATED, row.version, body);
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    Ok(response)
}

pub(in crate::site_management) async fn revoke_ingest_key(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path((site_id, environment, key_id)): Path<(String, String, String)>,
    headers: HeaderMap,
) -> Result<Response, ConfigurationApiError> {
    validate_identity(&site_id, Some(&environment))?;
    let version = parse_if_match(&headers)?;
    let row =
        config_store::revoke_ingest_key(&state.pool, &site_id, &environment, version, &key_id)
            .await
            .map_err(map_store_error)?;
    validate_stored_policy(&row, &state, &site_id, &environment)?;
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        policy_response(&state.pool, &row, &state).await?,
    ))
}
