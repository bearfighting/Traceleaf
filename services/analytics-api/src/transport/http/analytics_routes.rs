use crate::{
    analytics::state::AnalyticsState,
    transport::http::{analytics_handlers as handlers, capability_runtime, definition_revisions},
};
use axum::{Router, middleware, routing::get};

pub(crate) fn router(state: AnalyticsState) -> Router {
    routed(state, true)
}

fn routed(state: AnalyticsState, capability_gate: bool) -> Router {
    let routes = Router::new()
        .route(
            "/v1/sites/{site_id}/definition-revisions",
            get(definition_revisions::get_definition_revisions),
        )
        .route(
            "/v1/sites/{site_id}/overview",
            get(handlers::overview::overview),
        )
        .route(
            "/v1/sites/{site_id}/reports/{from}/{to}/overview",
            get(handlers::reports::range_overview),
        )
        .route(
            "/v1/sites/{site_id}/reports/{from}/{to}/timeline",
            get(handlers::reports::timeline),
        )
        .route(
            "/v1/sites/{site_id}/reports/{from}/{to}/pages",
            get(handlers::reports::pages),
        )
        .route(
            "/v1/sites/{site_id}/reports/{from}/{to}/conversions",
            get(handlers::reports::conversions),
        )
        .route(
            "/v1/sites/{site_id}/reports/{from}/{to}/funnels",
            get(handlers::reports::funnels),
        )
        .route(
            "/v1/sites/{site_id}/reports/{from}/{to}/web-vitals",
            get(handlers::reports::web_vitals),
        )
        .route(
            "/v1/sites/{site_id}/reports/{from}/{to}/geo",
            get(handlers::geo::countries),
        )
        .route(
            "/v1/sites/{site_id}/reports/{from}/{to}/events",
            get(handlers::reports::events),
        )
        .route(
            "/v1/sites/{site_id}/reports/{from}/{to}/visitors",
            get(handlers::audience_dimension_reports::visitors),
        )
        .route(
            "/v1/sites/{site_id}/reports/{from}/{to}/sessions",
            get(handlers::audience_dimension_reports::sessions),
        )
        .route(
            "/v1/sites/{site_id}/reports/{from}/{to}/dimensions/{dimension}",
            get(handlers::audience_dimension_reports::dimensions),
        )
        .with_state(state.clone());
    if capability_gate {
        routes.route_layer(middleware::from_fn_with_state(
            state,
            capability_runtime::gate,
        ))
    } else {
        routes
    }
}

#[cfg(test)]
mod tests {
    use super::routed;
    use crate::{
        analytics::{definition_catalog::DefinitionRevision, models::*, state::AnalyticsState},
        application::{
            analytics_queries::{AnalyticsReadUseCases, AnalyticsReportRequest},
            errors::AnalyticsApplicationError,
        },
    };
    use axum::{body::to_bytes, http::Request};
    use std::sync::Arc;
    use tower::ServiceExt;

    struct FakeReads {
        fail_with_storage_error: bool,
    }
    #[async_trait::async_trait]
    impl AnalyticsReadUseCases for FakeReads {
        async fn report(
            &self,
            request: AnalyticsReportRequest,
        ) -> Result<AnalyticsReportResponse, AnalyticsApplicationError> {
            if self.fail_with_storage_error {
                return Err(AnalyticsApplicationError::Storage("test".into()));
            }
            Ok(match request {
                AnalyticsReportRequest::RangeOverview { site_id, range } => {
                    AnalyticsReportResponse::RangeOverview(RangeOverviewResponse {
                        site_id,
                        from: range.from.to_string(),
                        to: range.to.to_string(),
                        page_views: 3,
                    })
                }
                AnalyticsReportRequest::Timeline { site_id, range } => {
                    AnalyticsReportResponse::Timeline(TimelineResponse {
                        site_id,
                        from: range.from.to_string(),
                        to: range.to.to_string(),
                        items: vec![],
                    })
                }
                AnalyticsReportRequest::Pages { site_id, range, .. } => {
                    AnalyticsReportResponse::Pages(PagesResponse {
                        site_id,
                        from: range.from.to_string(),
                        to: range.to.to_string(),
                        items: vec![],
                    })
                }
                _ => unimplemented!(),
            })
        }
        async fn overview_page_views(&self, _: &str) -> Result<i64, AnalyticsApplicationError> {
            if self.fail_with_storage_error {
                return Err(AnalyticsApplicationError::Storage("test".into()));
            }
            Ok(7)
        }
        async fn definition_revisions(
            &self,
            _: &str,
        ) -> Result<Vec<DefinitionRevision>, AnalyticsApplicationError> {
            Ok(vec![])
        }
        async fn resolve_definition_version(
            &self,
            _: &str,
            requested: Option<&str>,
        ) -> Result<Option<String>, AnalyticsApplicationError> {
            Ok(requested.map(str::to_owned))
        }
        async fn registry_site_without_capabilities(
            &self,
            _: &str,
        ) -> Result<bool, AnalyticsApplicationError> {
            Ok(false)
        }
        async fn visitors_report(
            &self,
            site_id: &str,
            range: DateRange,
        ) -> Result<VisitorSessionReportResponse, AnalyticsApplicationError> {
            if self.fail_with_storage_error {
                return Err(AnalyticsApplicationError::Storage("test".into()));
            }
            Ok(VisitorSessionReportResponse {
                site_id: site_id.into(),
                from: range.from.to_string(),
                to: range.to.to_string(),
                page_views: 0,
                unique_visitors: 0,
                sessions: 0,
                items: vec![],
                data_as_of: None,
                freshness_status: "rebuilding".into(),
                aggregation_version: 1,
            })
        }
        async fn dimensions_report(
            &self,
            site_id: &str,
            dimension: String,
            _: i64,
            range: DateRange,
        ) -> Result<DimensionReportResponse, AnalyticsApplicationError> {
            if self.fail_with_storage_error {
                return Err(AnalyticsApplicationError::Storage("test".into()));
            }
            Ok(DimensionReportResponse {
                site_id: site_id.into(),
                from: range.from.to_string(),
                to: range.to.to_string(),
                dimension,
                items: vec![],
                data_as_of: None,
                freshness_status: "current".into(),
                aggregation_version: 1,
            })
        }
    }

    async fn request_with_reads(
        uri: &str,
        reads: FakeReads,
    ) -> (axum::http::StatusCode, serde_json::Value) {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://u:p@127.0.0.1:1/db")
            .unwrap();
        let registry =
            std::sync::Arc::new(configuration_runtime::CapabilityRegistry::canonical().unwrap());
        let capabilities = configuration_runtime::CapabilityRuntime::with_registry(
            pool,
            "analytics_api",
            registry,
        )
        .unwrap();
        let app = routed(AnalyticsState::new(capabilities, Arc::new(reads)), false);
        let response = app
            .oneshot(Request::get(uri).body(axum::body::Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 65536).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    async fn request(uri: &str) -> (axum::http::StatusCode, serde_json::Value) {
        request_with_reads(
            uri,
            FakeReads {
                fail_with_storage_error: false,
            },
        )
        .await
    }

    #[tokio::test]
    async fn fake_read_port_http_contracts_do_not_need_database() {
        let (status, value) = request("/v1/sites/demo/overview").await;
        assert_eq!(status, 200);
        assert_eq!(value, serde_json::json!({"site_id":"demo","page_views":7}));
        let (status, value) = request("/v1/sites/demo/reports/2026-09-18/2026-09-19/pages").await;
        assert_eq!(status, 200);
        assert_eq!(
            value,
            serde_json::json!({"site_id":"demo","from":"2026-09-18","to":"2026-09-19","items":[]})
        );
        let (status, value) =
            request("/v1/sites/demo/reports/2026-09-18/2026-09-19/overview").await;
        assert_eq!(status, 200);
        assert_eq!(
            value,
            serde_json::json!({"site_id":"demo","from":"2026-09-18","to":"2026-09-19","page_views":3})
        );
        let (status, value) =
            request("/v1/sites/demo/reports/2026-09-18/2026-09-19/timeline").await;
        assert_eq!(status, 200);
        assert_eq!(
            value,
            serde_json::json!({"site_id":"demo","from":"2026-09-18","to":"2026-09-19","items":[]})
        );
        let (status, value) =
            request("/v1/sites/demo/reports/2026-09-19/2026-09-18/overview").await;
        assert_eq!(status, 400);
        assert_eq!(value["error"]["code"], "invalid_date_range");
        let (status, value) =
            request("/v1/sites/demo/reports/2026-09-18/2026-09-19/pages?limit=0").await;
        assert_eq!(status, 400);
        assert_eq!(value["error"]["code"], "invalid_limit");
        let (status, value) =
            request("/v1/sites/demo/reports/2026-09-18/2026-09-19/conversions").await;
        assert_eq!(status, 400);
        assert_eq!(value["error"]["code"], "invalid_definition_version");
        let (status, value) =
            request("/v1/sites/demo/reports/2026-09-18/2026-09-19/dimensions/nope").await;
        assert_eq!(status, 400);
        assert_eq!(value["error"]["code"], "invalid_dimension");
        let (status, value) = request_with_reads(
            "/v1/sites/demo/reports/2026-09-18/2026-09-19/overview",
            FakeReads {
                fail_with_storage_error: true,
            },
        )
        .await;
        assert_eq!(status, 500);
        assert_eq!(value["error"]["code"], "analytics_api_error");
        let (status, value) = request_with_reads(
            "/v1/sites/demo/overview",
            FakeReads {
                fail_with_storage_error: true,
            },
        )
        .await;
        assert_eq!(status, 500);
        assert_eq!(value["error"]["code"], "analytics_api_error");
        for path in [
            "/v1/sites/demo/reports/2026-09-18/2026-09-19/visitors",
            "/v1/sites/demo/reports/2026-09-18/2026-09-19/dimensions/language",
        ] {
            let (status, value) = request_with_reads(
                path,
                FakeReads {
                    fail_with_storage_error: true,
                },
            )
            .await;
            assert_eq!(status, 500);
            assert_eq!(value["error"]["code"], "analytics_api_error");
        }
    }
}
