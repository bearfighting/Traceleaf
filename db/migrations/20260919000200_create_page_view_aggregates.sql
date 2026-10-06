CREATE TABLE page_view_daily (
    site_id VARCHAR(64) NOT NULL,
    day DATE NOT NULL,
    page_views BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, day)
);

CREATE TABLE page_view_routes (
    site_id VARCHAR(64) NOT NULL,
    day DATE NOT NULL,
    path TEXT NOT NULL,
    page_views BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, day, path)
);
