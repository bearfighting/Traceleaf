-- Keep the PR3 derived tables efficient for generation-scoped date and
-- visitor/session queries. This is additive so databases that already ran
-- the PR3 table migration can upgrade without rewriting existing tables.
CREATE INDEX normalized_context_generation_site_raw_idx
    ON normalized_event_context (generation_id, site_id, raw_event_id);

CREATE INDEX visitor_event_facts_generation_site_occurred_idx
    ON visitor_event_facts (generation_id, site_id, occurred_at);

CREATE INDEX session_events_generation_site_occurred_idx
    ON session_events (generation_id, site_id, occurred_at);
