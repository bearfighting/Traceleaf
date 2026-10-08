use crate::application::analytics_queries::AnalyticsReportRequest;
use crate::{
    analytics::{definition_catalog::DefinitionRevision, models::DateRange},
    application::analytics_queries::AnalyticsReadUseCases,
};
use sqlx::PgPool;

pub(crate) struct AnalyticsReadAdapter {
    pool: PgPool,
    default_definition_version: String,
}

impl AnalyticsReadAdapter {
    pub(crate) fn new(pool: PgPool, default_definition_version: String) -> Self {
        Self {
            pool,
            default_definition_version,
        }
    }
}

#[async_trait::async_trait]
impl AnalyticsReadUseCases for AnalyticsReadAdapter {
    async fn report(
        &self,
        request: AnalyticsReportRequest,
    ) -> Result<
        crate::analytics::models::AnalyticsReportResponse,
        crate::application::errors::AnalyticsApplicationError,
    > {
        use crate::analytics::models::*;
        use crate::storage::postgres::analytics_queries as q;
        match request {
            AnalyticsReportRequest::RangeOverview { site_id, range } => {
                let page_views = q::range_overview(&self.pool, &site_id, range)
                    .await
                    .map_err(|e| {
                        crate::application::errors::AnalyticsApplicationError::Storage(
                            e.to_string(),
                        )
                    })?;
                Ok(
                    crate::analytics::models::AnalyticsReportResponse::RangeOverview(
                        RangeOverviewResponse {
                            site_id,
                            from: range.from.format("%Y-%m-%d").to_string(),
                            to: range.to.format("%Y-%m-%d").to_string(),
                            page_views,
                        },
                    ),
                )
            }
            AnalyticsReportRequest::Timeline { site_id, range } => {
                let items = q::timeline(&self.pool, &site_id, range)
                    .await
                    .map_err(|e| {
                        crate::application::errors::AnalyticsApplicationError::Storage(
                            e.to_string(),
                        )
                    })?
                    .into_iter()
                    .map(|r| TimelineItem {
                        day: r.day,
                        page_views: r.page_views,
                    })
                    .collect();
                Ok(crate::analytics::models::AnalyticsReportResponse::Timeline(
                    TimelineResponse {
                        site_id,
                        from: range.from.format("%Y-%m-%d").to_string(),
                        to: range.to.format("%Y-%m-%d").to_string(),
                        items,
                    },
                ))
            }
            AnalyticsReportRequest::Pages {
                site_id,
                limit,
                range,
            } => {
                let items = q::pages(&self.pool, &site_id, range, limit)
                    .await
                    .map_err(|e| {
                        crate::application::errors::AnalyticsApplicationError::Storage(
                            e.to_string(),
                        )
                    })?
                    .into_iter()
                    .map(|r| PageItem {
                        path: r.path,
                        page_views: r.page_views,
                    })
                    .collect();
                Ok(crate::analytics::models::AnalyticsReportResponse::Pages(
                    PagesResponse {
                        site_id,
                        from: range.from.format("%Y-%m-%d").to_string(),
                        to: range.to.format("%Y-%m-%d").to_string(),
                        items,
                    },
                ))
            }
            AnalyticsReportRequest::Events {
                site_id,
                limit,
                event_name,
                range,
            } => {
                let total =
                    q::custom_event_total(&self.pool, &site_id, range, event_name.as_deref())
                        .await
                        .map_err(|e| {
                            crate::application::errors::AnalyticsApplicationError::Storage(
                                e.to_string(),
                            )
                        })?;
                let items = q::custom_event_daily_rows(
                    &self.pool,
                    &site_id,
                    range,
                    event_name.as_deref(),
                    limit,
                )
                .await
                .map_err(|e| {
                    crate::application::errors::AnalyticsApplicationError::Storage(e.to_string())
                })?
                .into_iter()
                .map(|r| EventDailyItem {
                    day: r.day,
                    event_name: r.event_name,
                    event_count: r.event_count,
                })
                .collect();
                let data_as_of = q::custom_event_watermark(&self.pool, &site_id)
                    .await
                    .map_err(|e| {
                        crate::application::errors::AnalyticsApplicationError::Storage(
                            e.to_string(),
                        )
                    })?;
                let freshness_status = q::custom_event_freshness(&self.pool, &site_id)
                    .await
                    .map_err(|e| {
                        crate::application::errors::AnalyticsApplicationError::Storage(
                            e.to_string(),
                        )
                    })?;
                Ok(crate::analytics::models::AnalyticsReportResponse::Events(
                    EventsReportResponse {
                        site_id,
                        from: range.from.format("%Y-%m-%d").to_string(),
                        to: range.to.format("%Y-%m-%d").to_string(),
                        total,
                        items,
                        data_as_of,
                        freshness_status,
                        aggregation_version: 1,
                    },
                ))
            }
            AnalyticsReportRequest::WebVitals {
                site_id,
                limit,
                path,
                range,
            } => {
                let rows = q::web_vital_rows(&self.pool, &site_id, range, path.as_deref(), limit)
                    .await
                    .map_err(|e| {
                        crate::application::errors::AnalyticsApplicationError::Storage(
                            e.to_string(),
                        )
                    })?;
                let total = q::web_vital_total(&self.pool, &site_id, range, path.as_deref())
                    .await
                    .map_err(|e| {
                        crate::application::errors::AnalyticsApplicationError::Storage(
                            e.to_string(),
                        )
                    })?;
                let items = rows
                    .into_iter()
                    .map(|r| WebVitalReportItem {
                        path: r.path,
                        metric: r.metric,
                        count: r.count,
                        p75: r.p75,
                        good_count: r.good_count,
                        needs_improvement_count: r.needs_improvement_count,
                        poor_count: r.poor_count,
                        status: if r.count < 4 {
                            "insufficient_data"
                        } else {
                            "available"
                        }
                        .to_owned(),
                    })
                    .collect();
                let data_as_of =
                    q::web_vital_watermark(&self.pool, &site_id)
                        .await
                        .map_err(|e| {
                            crate::application::errors::AnalyticsApplicationError::Storage(
                                e.to_string(),
                            )
                        })?;
                let freshness_status =
                    q::web_vital_freshness(&self.pool, &site_id)
                        .await
                        .map_err(|e| {
                            crate::application::errors::AnalyticsApplicationError::Storage(
                                e.to_string(),
                            )
                        })?;
                Ok(
                    crate::analytics::models::AnalyticsReportResponse::WebVitals(
                        WebVitalReportResponse {
                            site_id,
                            from: range.from.format("%Y-%m-%d").to_string(),
                            to: range.to.format("%Y-%m-%d").to_string(),
                            total,
                            items,
                            data_as_of,
                            freshness_status,
                            aggregation_version: 1,
                        },
                    ),
                )
            }
            AnalyticsReportRequest::Conversions {
                site_id,
                limit,
                definition_id,
                definition_version,
                range,
            } => {
                let rows = q::conversion_rows(
                    &self.pool,
                    &site_id,
                    &definition_version,
                    range,
                    definition_id.as_deref(),
                    limit,
                )
                .await
                .map_err(|e| {
                    crate::application::errors::AnalyticsApplicationError::Storage(e.to_string())
                })?;
                let total = q::conversion_total(
                    &self.pool,
                    &site_id,
                    &definition_version,
                    range,
                    definition_id.as_deref(),
                )
                .await
                .map_err(|e| {
                    crate::application::errors::AnalyticsApplicationError::Storage(e.to_string())
                })?;
                let items = rows
                    .into_iter()
                    .map(|r| ConversionReportItem {
                        definition_id: r.definition_id,
                        day: r.day,
                        event_count: r.event_count,
                        converted_sessions: r.converted_sessions,
                        eligible_sessions: r.eligible_sessions,
                        conversion_rate: if r.eligible_sessions == 0 {
                            0.0
                        } else {
                            r.converted_sessions as f64 / r.eligible_sessions as f64
                        },
                    })
                    .collect();
                let data_as_of = q::definition_revision_watermark(
                    &self.pool,
                    &site_id,
                    "conversions",
                    &definition_version,
                )
                .await
                .map_err(|e| {
                    crate::application::errors::AnalyticsApplicationError::Storage(e.to_string())
                })?;
                let freshness_status = q::definition_freshness(
                    &self.pool,
                    &site_id,
                    "conversions",
                    &definition_version,
                )
                .await
                .map_err(|e| {
                    crate::application::errors::AnalyticsApplicationError::Storage(e.to_string())
                })?;
                Ok(
                    crate::analytics::models::AnalyticsReportResponse::Conversions(
                        ConversionReportResponse {
                            site_id,
                            from: range.from.format("%Y-%m-%d").to_string(),
                            to: range.to.format("%Y-%m-%d").to_string(),
                            total,
                            definition_version,
                            items,
                            data_as_of,
                            freshness_status,
                            aggregation_version: 1,
                        },
                    ),
                )
            }
            AnalyticsReportRequest::Funnels {
                site_id,
                limit,
                definition_id,
                definition_version,
                range,
            } => {
                let rows = q::funnel_rows(
                    &self.pool,
                    &site_id,
                    &definition_version,
                    range,
                    definition_id.as_deref(),
                    limit,
                )
                .await
                .map_err(|e| {
                    crate::application::errors::AnalyticsApplicationError::Storage(e.to_string())
                })?;
                let total = q::funnel_total(
                    &self.pool,
                    &site_id,
                    &definition_version,
                    range,
                    definition_id.as_deref(),
                )
                .await
                .map_err(|e| {
                    crate::application::errors::AnalyticsApplicationError::Storage(e.to_string())
                })?;
                let items = rows
                    .into_iter()
                    .map(|r| FunnelReportItem {
                        definition_id: r.definition_id,
                        day: r.day,
                        step_index: r.step_index,
                        sessions: r.sessions,
                        conversion_rate: if r.previous_step_sessions == 0 {
                            0.0
                        } else {
                            r.sessions as f64 / r.previous_step_sessions as f64
                        },
                    })
                    .collect();
                let data_as_of = q::definition_revision_watermark(
                    &self.pool,
                    &site_id,
                    "funnels",
                    &definition_version,
                )
                .await
                .map_err(|e| {
                    crate::application::errors::AnalyticsApplicationError::Storage(e.to_string())
                })?;
                let freshness_status =
                    q::definition_freshness(&self.pool, &site_id, "funnels", &definition_version)
                        .await
                        .map_err(|e| {
                            crate::application::errors::AnalyticsApplicationError::Storage(
                                e.to_string(),
                            )
                        })?;
                Ok(crate::analytics::models::AnalyticsReportResponse::Funnels(
                    FunnelReportResponse {
                        site_id,
                        from: range.from.format("%Y-%m-%d").to_string(),
                        to: range.to.format("%Y-%m-%d").to_string(),
                        total,
                        definition_version,
                        items,
                        data_as_of,
                        freshness_status,
                        aggregation_version: 1,
                    },
                ))
            }
            AnalyticsReportRequest::Geo { site_id, range } => {
                let items = q::geo_country_rows(&self.pool, &site_id, range)
                    .await
                    .map_err(|e| {
                        crate::application::errors::AnalyticsApplicationError::Storage(
                            e.to_string(),
                        )
                    })?
                    .into_iter()
                    .map(|r| GeoCountryItem {
                        country_code: r.country_code,
                        page_views: r.page_views,
                    })
                    .collect();
                let coverage_from = q::geo_country_coverage_from(&self.pool, &site_id)
                    .await
                    .map_err(|e| {
                        crate::application::errors::AnalyticsApplicationError::Storage(
                            e.to_string(),
                        )
                    })?;
                let providers = q::geo_country_providers(&self.pool, &site_id, range)
                    .await
                    .map_err(|e| {
                        crate::application::errors::AnalyticsApplicationError::Storage(
                            e.to_string(),
                        )
                    })?;
                let data_as_of =
                    q::page_view_watermark(&self.pool, &site_id)
                        .await
                        .map_err(|e| {
                            crate::application::errors::AnalyticsApplicationError::Storage(
                                e.to_string(),
                            )
                        })?;
                let freshness_status = q::geo_country_freshness(&self.pool, &site_id)
                    .await
                    .map_err(|e| {
                        crate::application::errors::AnalyticsApplicationError::Storage(
                            e.to_string(),
                        )
                    })?;
                Ok(crate::analytics::models::AnalyticsReportResponse::Geo(
                    GeoCountryReportResponse {
                        site_id,
                        from: range.from.format("%Y-%m-%d").to_string(),
                        to: range.to.format("%Y-%m-%d").to_string(),
                        coverage_from,
                        providers,
                        items,
                        data_as_of,
                        freshness_status,
                        aggregation_version: 1,
                    },
                ))
            }
        }
    }
    async fn overview_page_views(
        &self,
        site_id: &str,
    ) -> Result<i64, crate::application::errors::AnalyticsApplicationError> {
        crate::storage::postgres::analytics_queries::overview(&self.pool, site_id)
            .await
            .map_err(|e| {
                crate::application::errors::AnalyticsApplicationError::Storage(e.to_string())
            })
    }
    async fn definition_revisions(
        &self,
        site_id: &str,
    ) -> Result<Vec<DefinitionRevision>, crate::application::errors::AnalyticsApplicationError>
    {
        crate::storage::postgres::definition_catalog::list_revisions(&self.pool, site_id)
            .await
            .map_err(|e| {
                crate::application::errors::AnalyticsApplicationError::Storage(e.to_string())
            })
    }
    async fn resolve_definition_version(
        &self,
        site_id: &str,
        requested: Option<&str>,
    ) -> Result<Option<String>, crate::application::errors::AnalyticsApplicationError> {
        crate::storage::postgres::definition_catalog::resolve_version(
            &self.pool,
            site_id,
            requested,
            &self.default_definition_version,
        )
        .await
        .map_err(|e| crate::application::errors::AnalyticsApplicationError::Storage(e.to_string()))
    }
    async fn registry_site_without_capabilities(
        &self,
        site_id: &str,
    ) -> Result<bool, crate::application::errors::AnalyticsApplicationError> {
        crate::storage::postgres::definition_catalog::registry_site_without_capabilities(
            &self.pool, site_id,
        )
        .await
        .map_err(|e| crate::application::errors::AnalyticsApplicationError::Storage(e.to_string()))
    }

    async fn visitors_report(
        &self,
        site_id: &str,
        range: DateRange,
    ) -> Result<
        crate::analytics::models::VisitorSessionReportResponse,
        crate::application::errors::AnalyticsApplicationError,
    > {
        let transactions =
            super::report_transactions::PostgresReportTransactionFactory(self.pool.clone());
        super::report_transactions::visitors_report(&transactions, site_id, range).await
    }

    async fn dimensions_report(
        &self,
        site_id: &str,
        dimension: String,
        limit: i64,
        range: DateRange,
    ) -> Result<
        crate::analytics::models::DimensionReportResponse,
        crate::application::errors::AnalyticsApplicationError,
    > {
        let transactions =
            super::report_transactions::PostgresReportTransactionFactory(self.pool.clone());
        super::report_transactions::dimensions_report(
            &transactions,
            site_id,
            dimension,
            limit,
            range,
        )
        .await
    }
}

#[cfg(test)]
mod report_transaction_tests {
    use super::super::report_transactions::{
        DimensionReportRead, ReportReadTransaction, ReportTransactionFactory, VisitorReportRead,
    };
    use crate::{
        analytics::models::DateRange,
        application::errors::AnalyticsApplicationError,
        storage::postgres::query_rows::{
            ActiveGeneration, DimensionRow, VisitorSessionRow, WatermarkRow,
        },
    };
    use chrono::{NaiveDate, TimeZone, Utc};

    struct FakeTransactions {
        fail_at: Option<&'static str>,
    }

    struct FakeTransaction {
        fail_at: Option<&'static str>,
    }

    fn failure(fail_at: Option<&'static str>, stage: &'static str) -> Result<(), String> {
        if fail_at == Some(stage) {
            Err(format!("injected {stage} failure"))
        } else {
            Ok(())
        }
    }

    #[async_trait::async_trait]
    impl ReportTransactionFactory for FakeTransactions {
        async fn begin(&self) -> Result<Box<dyn ReportReadTransaction + '_>, String> {
            failure(self.fail_at, "begin")?;
            Ok(Box::new(FakeTransaction {
                fail_at: self.fail_at,
            }))
        }
    }

    #[async_trait::async_trait]
    impl ReportReadTransaction for FakeTransaction {
        async fn visitors(&mut self, _: &str, _: DateRange) -> Result<VisitorReportRead, String> {
            failure(self.fail_at, "read")?;
            Ok(VisitorReportRead {
                generation: Some(ActiveGeneration {
                    generation_id: "generation-a".into(),
                    aggregation_version: 7,
                }),
                page_views: 8,
                unique_visitors: 4,
                sessions: 5,
                items: vec![VisitorSessionRow {
                    day: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
                    page_views: 8,
                    unique_visitors: 4,
                    sessions: 5,
                }],
                marks: vec![
                    WatermarkRow {
                        source_name: "page_views".into(),
                        processed_received_watermark: Some(Utc.timestamp_opt(20, 0).unwrap()),
                    },
                    WatermarkRow {
                        source_name: "visitor_session".into(),
                        processed_received_watermark: Some(Utc.timestamp_opt(10, 0).unwrap()),
                    },
                ],
                freshness_status: "current".into(),
            })
        }

        async fn dimensions(
            &mut self,
            _: &str,
            _: &str,
            _: i64,
            _: DateRange,
        ) -> Result<DimensionReportRead, String> {
            failure(self.fail_at, "read")?;
            Ok(DimensionReportRead {
                generation: Some(ActiveGeneration {
                    generation_id: "generation-a".into(),
                    aggregation_version: 7,
                }),
                items: vec![DimensionRow {
                    value: "desktop".into(),
                    page_views: 8,
                    unique_visitors: 4,
                    sessions: 5,
                }],
                marks: vec![
                    WatermarkRow {
                        source_name: "page_views".into(),
                        processed_received_watermark: Some(Utc.timestamp_opt(20, 0).unwrap()),
                    },
                    WatermarkRow {
                        source_name: "dimensions".into(),
                        processed_received_watermark: Some(Utc.timestamp_opt(10, 0).unwrap()),
                    },
                ],
                freshness_status: "current".into(),
            })
        }

        async fn commit(self: Box<Self>) -> Result<(), String> {
            failure(self.fail_at, "commit")
        }
    }

    fn range() -> DateRange {
        DateRange {
            from: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
            to: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
        }
    }

    fn assert_storage_error(error: AnalyticsApplicationError, stage: &str) {
        assert!(matches!(error, AnalyticsApplicationError::Storage(_)));
        assert!(
            error
                .to_string()
                .contains(&format!("injected {stage} failure"))
        );
    }

    #[tokio::test]
    async fn visitors_report_runs_injected_transaction_and_maps_every_failure_stage() {
        for stage in ["begin", "read", "commit"] {
            let error = super::super::report_transactions::visitors_report(
                &FakeTransactions {
                    fail_at: Some(stage),
                },
                "site-a",
                range(),
            )
            .await
            .unwrap_err();
            assert_storage_error(error, stage);
        }
        let response = super::super::report_transactions::visitors_report(
            &FakeTransactions { fail_at: None },
            "site-a",
            range(),
        )
        .await
        .unwrap();
        assert_eq!(response.site_id, "site-a");
        assert_eq!(
            (
                response.page_views,
                response.unique_visitors,
                response.sessions
            ),
            (8, 4, 5)
        );
        assert_eq!(response.items.len(), 1);
        assert_eq!(response.aggregation_version, 7);
        assert_eq!(response.data_as_of, Some(Utc.timestamp_opt(10, 0).unwrap()));
    }

    #[tokio::test]
    async fn dimensions_report_runs_injected_transaction_and_maps_every_failure_stage() {
        for stage in ["begin", "read", "commit"] {
            let error = super::super::report_transactions::dimensions_report(
                &FakeTransactions {
                    fail_at: Some(stage),
                },
                "site-a",
                "device_type".into(),
                10,
                range(),
            )
            .await
            .unwrap_err();
            assert_storage_error(error, stage);
        }
        let response = super::super::report_transactions::dimensions_report(
            &FakeTransactions { fail_at: None },
            "site-a",
            "device_type".into(),
            10,
            range(),
        )
        .await
        .unwrap();
        assert_eq!(response.site_id, "site-a");
        assert_eq!(response.dimension, "device_type");
        assert_eq!(response.items.len(), 1);
        assert_eq!(response.items[0].value, "desktop");
        assert_eq!(response.aggregation_version, 7);
        assert_eq!(response.data_as_of, Some(Utc.timestamp_opt(10, 0).unwrap()));
    }
}
