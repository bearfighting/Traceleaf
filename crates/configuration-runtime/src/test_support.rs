use serde_json::{Value, json};

pub(crate) fn capability_document() -> Value {
    json!({
        "schema_version": 1, "site_id": "site_a", "version": 3,
        "updated_at": "2026-09-25T00:00:00Z",
        "capabilities": {
            "page_views": {"enabled": true, "settings": {}},
            "browser_context": {"enabled": true, "settings": {}},
            "anonymous_visitors": {"enabled": false, "settings": {}},
            "sessions": {"enabled": false, "settings": {}},
            "dimensions": {"enabled": false, "settings": {}},
            "custom_events": {"enabled": true, "settings": {}},
            "web_vitals": {"enabled": true, "settings": {}},
            "conversions": {"enabled": true, "settings": {}},
            "funnels": {"enabled": true, "settings": {}},
            "geo": {"enabled": true, "settings": {}}
        },
        "consent_policy": "required",
        "privacy_constraints": ["no_ip_persistence", "no_fingerprinting", "consent_required"]
    })
}
