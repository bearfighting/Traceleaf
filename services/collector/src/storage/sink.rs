use sqlx::{PgPool, postgres::PgPoolOptions};

use async_trait::async_trait;
use chrono::{DateTime, Utc};

use crate::application::event_sink::{EventSink, SinkError, StoredEvent};
use crate::domain::protocol::AnalyticsEvent;

impl From<sqlx::Error> for SinkError {
    fn from(error: sqlx::Error) -> Self {
        Self::Storage(error.to_string())
    }
}

#[derive(Clone)]
pub struct PostgresSink {
    pool: PgPool,
}

impl PostgresSink {
    pub async fn connect(database_url: &str) -> Result<Self, SinkError> {
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .connect_lazy(database_url)?;
        Ok(Self { pool })
    }

    pub fn pool(&self) -> PgPool {
        self.pool.clone()
    }
}

#[async_trait]
impl EventSink for PostgresSink {
    async fn accept(&self, events: Vec<StoredEvent>) -> Result<(), SinkError> {
        let mut transaction = self.pool.begin().await?;
        let site_ids = events
            .iter()
            .map(|stored| stored.event.site_id().to_owned())
            .collect::<std::collections::BTreeSet<_>>();
        for site_id in site_ids {
            sqlx::query(
                "SELECT pg_advisory_xact_lock(hashtextextended('definition-revision:' || $1, 0))",
            )
            .bind(site_id)
            .execute(&mut *transaction)
            .await?;
        }
        let received_at = sqlx::query_scalar::<_, DateTime<Utc>>("SELECT clock_timestamp()")
            .fetch_one(&mut *transaction)
            .await?;

        let mut web_vital_links = Vec::new();
        for stored in events {
            let occurred_at = DateTime::<Utc>::from_timestamp_millis(stored.event.occurred_at())
                .ok_or(SinkError::InvalidTimestamp)?;
            if let AnalyticsEvent::WebVital(vital) = &stored.event {
                web_vital_links.push((
                    vital.site_id.clone(),
                    vital.page_view_event_id.clone(),
                    vital.path.clone(),
                    DateTime::<Utc>::from_timestamp_millis(vital.page_view_occurred_at)
                        .ok_or(SinkError::InvalidTimestamp)?,
                ));
            }
            let event_type = stored.event.event_type_name();

            let raw_event_id = sqlx::query_scalar::<_, i64>(
                "INSERT INTO raw_events
                (site_id, event_id, schema_version, event_type, occurred_at,
                     received_at, path, url, title, referrer, visitor_id,
                     context_schema_version, payload)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid, $12, $13)
                 ON CONFLICT (site_id, event_id) DO NOTHING
                 RETURNING id",
            )
            .bind(stored.event.site_id())
            .bind(stored.event.event_id())
            .bind(i32::from(stored.event.schema_version()))
            .bind(event_type)
            .bind(occurred_at)
            .bind(received_at)
            .bind(stored.event.path())
            .bind(stored.event.url())
            .bind(stored.event.title())
            .bind(stored.event.referrer())
            .bind(stored.event.visitor_id())
            .bind(stored.event.context_schema_version())
            .bind(stored.payload)
            .fetch_optional(&mut *transaction)
            .await?;

            if let (Some(raw_event_id), Some(geo)) = (raw_event_id, stored.geo)
                && matches!(stored.event, AnalyticsEvent::PageView(_))
            {
                sqlx::query(
                        "INSERT INTO geo_event_metadata
                         (raw_event_id, site_id, country_code, provider, dataset_version, parser_version)
                         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (raw_event_id) DO NOTHING",
                    )
                    .bind(raw_event_id)
                    .bind(stored.event.site_id())
                    .bind(geo.country_code)
                    .bind(geo.provider)
                    .bind(geo.dataset_version)
                    .bind(geo.parser_version)
                    .execute(&mut *transaction)
                    .await?;
            }
        }
        for (site_id, page_view_id, path, page_view_at) in web_vital_links {
            let linked=sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM raw_events WHERE site_id=$1 AND event_id=$2 AND event_type='page_view' AND path=$3 AND occurred_at=$4)")
                .bind(site_id).bind(page_view_id).bind(path).bind(page_view_at).fetch_one(&mut *transaction).await?;
            if !linked {
                return Err(SinkError::InvalidWebVitalAssociation);
            }
        }

        transaction.commit().await?;
        Ok(())
    }
}
