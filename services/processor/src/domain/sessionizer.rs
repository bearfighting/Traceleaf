use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};

const SESSION_TIMEOUT_SECONDS: i64 = 30 * 60;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionInput {
    pub event_id: String,
    pub site_id: String,
    pub visitor_id: String,
    pub occurred_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionEventOutput {
    pub event_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionOutput {
    pub session_id: String,
    pub site_id: String,
    pub visitor_id: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub page_views: i64,
    pub events: Vec<SessionEventOutput>,
}

pub fn sessionize(events: &[SessionInput], generation_id: &str) -> Vec<SessionOutput> {
    let mut sorted = events.to_vec();
    sorted.sort_by(|left, right| {
        left.occurred_at
            .cmp(&right.occurred_at)
            .then_with(|| left.event_id.cmp(&right.event_id))
    });

    let mut sessions = Vec::new();
    for event in sorted {
        let starts_new = sessions.last().is_none_or(|current: &SessionOutput| {
            current.site_id != event.site_id
                || current.visitor_id != event.visitor_id
                || event.occurred_at.date_naive() != current.ended_at.date_naive()
                || event
                    .occurred_at
                    .signed_duration_since(current.ended_at)
                    .num_seconds()
                    >= SESSION_TIMEOUT_SECONDS
        });

        if starts_new {
            let session_id = deterministic_session_id(
                generation_id,
                &event.site_id,
                &event.visitor_id,
                &event.event_id,
            );
            sessions.push(SessionOutput {
                session_id,
                site_id: event.site_id.clone(),
                visitor_id: event.visitor_id.clone(),
                started_at: event.occurred_at,
                ended_at: event.occurred_at,
                page_views: 1,
                events: vec![SessionEventOutput {
                    event_id: event.event_id,
                    session_id: String::new(),
                }],
            });
        } else if let Some(current) = sessions.last_mut() {
            current.ended_at = event.occurred_at;
            current.page_views += 1;
            current.events.push(SessionEventOutput {
                event_id: event.event_id,
                session_id: String::new(),
            });
        }
    }

    for session in &mut sessions {
        for event in &mut session.events {
            event.session_id = session.session_id.clone();
        }
    }
    sessions
}

pub fn deterministic_session_id(
    generation_id: &str,
    site_id: &str,
    visitor_id: &str,
    first_event_id: &str,
) -> String {
    let input = format!(
        "web-analytics:session:v1\0{generation_id}\0{site_id}\0{visitor_id}\0{first_event_id}"
    );
    let digest = Sha256::digest(input.as_bytes());
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format_uuid(bytes)
}

fn format_uuid(bytes: [u8; 16]) -> String {
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
    )
}

#[cfg(test)]
mod tests {
    use super::{SessionInput, deterministic_session_id, sessionize};
    use chrono::{DateTime, Utc};

    fn event(id: &str, timestamp: &str) -> SessionInput {
        SessionInput {
            event_id: id.to_owned(),
            site_id: "site_a".to_owned(),
            visitor_id: "550e8400-e29b-41d4-a716-446655440000".to_owned(),
            occurred_at: timestamp.parse::<DateTime<Utc>>().unwrap(),
        }
    }

    #[test]
    fn applies_timeout_midnight_and_event_id_ordering() {
        let sessions = sessionize(
            &[
                event("b", "2026-09-18T00:00:00Z"),
                event("a", "2026-09-18T00:00:00Z"),
                event("c", "2026-09-18T00:29:59Z"),
                event("d", "2026-09-18T01:00:00Z"),
                event("e", "2026-09-19T00:00:01Z"),
            ],
            "00000000-0000-4000-8000-000000000001",
        );
        assert_eq!(sessions.len(), 3);
        assert_eq!(sessions[0].page_views, 3);
        assert_eq!(sessions[1].page_views, 1);
        assert_eq!(sessions[2].page_views, 1);
        assert_eq!(sessions[0].events[0].event_id, "a");
    }

    #[test]
    fn session_id_is_deterministic_and_uuid_shaped() {
        let left = deterministic_session_id("generation", "site", "visitor", "event");
        let right = deterministic_session_id("generation", "site", "visitor", "event");
        assert_eq!(left, right);
        assert_eq!(left.len(), 36);
        assert_eq!(&left[14..15], "5");
    }
}
