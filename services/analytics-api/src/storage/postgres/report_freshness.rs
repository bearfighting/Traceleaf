use chrono::{DateTime, Utc};

use super::query_rows::WatermarkRow;

/// Returns the latest point shared by every required report source.
///
/// A report is only current through its oldest required source watermark.
pub(crate) fn common_watermark(
    rows: &[WatermarkRow],
    required_sources: &[&str],
) -> Option<DateTime<Utc>> {
    required_sources
        .iter()
        .map(|source| {
            rows.iter()
                .find(|row| row.source_name == *source)
                .and_then(|row| row.processed_received_watermark)
        })
        .collect::<Option<Vec<_>>>()
        .and_then(|values| values.into_iter().min())
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::super::query_rows::WatermarkRow;
    use super::common_watermark;

    fn row(source_name: &str, watermark: Option<chrono::DateTime<Utc>>) -> WatermarkRow {
        WatermarkRow {
            source_name: source_name.to_owned(),
            processed_received_watermark: watermark,
        }
    }

    #[test]
    fn returns_oldest_watermark_for_all_required_sources() {
        let rows = [
            row("page_views", Some(Utc.timestamp_opt(20, 0).unwrap())),
            row("dimensions", Some(Utc.timestamp_opt(10, 0).unwrap())),
        ];

        assert_eq!(
            common_watermark(&rows, &["page_views", "dimensions"]),
            Some(Utc.timestamp_opt(10, 0).unwrap())
        );
    }

    #[test]
    fn returns_none_when_a_required_source_is_missing_or_unprocessed() {
        let rows = [row("page_views", Some(Utc.timestamp_opt(20, 0).unwrap()))];

        assert_eq!(common_watermark(&rows, &["page_views", "dimensions"]), None);
        assert_eq!(
            common_watermark(&[row("page_views", None)], &["page_views"]),
            None
        );
    }
}
