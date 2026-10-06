ALTER TABLE analytics_watermarks
    ADD CONSTRAINT analytics_watermarks_generation_scope_check
    CHECK (
        (source_name = 'page_views' AND generation_id IS NULL)
        OR (source_name <> 'page_views' AND generation_id IS NOT NULL)
    );
