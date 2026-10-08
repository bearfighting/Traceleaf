use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};

use crate::{
    application::site_management_state::SiteManagementState,
    site_management::errors::ConfigurationApiError,
};

#[derive(Clone, Copy, Debug)]
pub(crate) struct AdminAuth;

impl FromRequestParts<SiteManagementState> for AdminAuth {
    type Rejection = ConfigurationApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &SiteManagementState,
    ) -> Result<Self, Self::Rejection> {
        let Some(tokens) = state.admin_tokens.as_ref() else {
            return Err(ConfigurationApiError::Unauthorized);
        };
        let valid = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| {
                let (scheme, credentials) = value.split_once(' ')?;
                scheme
                    .eq_ignore_ascii_case("Bearer")
                    .then(|| credentials.trim_start_matches(' '))
            })
            .is_some_and(|candidate| tokens.accepts(candidate));
        if valid {
            Ok(Self)
        } else {
            Err(ConfigurationApiError::Unauthorized)
        }
    }
}
