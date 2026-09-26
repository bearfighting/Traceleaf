import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConfigurationEditor, ConfigurationErrorFeedback } from "./configuration-editor";

const result = {
  kind: "ready" as const,
  capabilities: {
    configuration: {
      schema_version: 1 as const,
      site_id: "site-one",
      version: 3,
      updated_at: "2026-09-26T00:00:00Z",
      capabilities: {
        page_views: { enabled: true, settings: {} },
        browser_context: { enabled: true, settings: {} },
        anonymous_visitors: { enabled: true, settings: {} },
        sessions: { enabled: true, settings: {} },
        dimensions: { enabled: true, settings: {} },
        custom_events: { enabled: true, settings: {} },
        web_vitals: { enabled: true, settings: {} },
        conversions: { enabled: true, settings: {} },
        funnels: { enabled: true, settings: {} },
        geo: { enabled: true, settings: {} },
      },
      consent_policy: "required" as const,
      privacy_constraints: ["no_ip_persistence", "no_fingerprinting", "consent_required"] as [
        "no_ip_persistence",
        "no_fingerprinting",
        "consent_required",
      ],
    },
    effective_state: {
      status: "pending" as const,
      stored_version: 3,
      applied_versions: { collector: 3, processor: null, analytics_api: 2 },
    },
  },
  policy: null,
};

describe("ConfigurationEditor", () => {
  it("renders privacy requirements, dependencies, runtime versions, and empty policy state", () => {
    const markup = renderToStaticMarkup(
      <ConfigurationEditor siteId="site-one" environment="production" result={result} />,
    );
    expect(markup).toContain("Consent required.");
    expect(markup).toContain("Requires Anonymous Visitors.");
    expect(markup).toContain("Runtime status: pending");
    expect(markup).toContain("processor: not reported");
    expect(markup).toContain("Create environment policy");
    expect(markup).toContain("Create Ingest Key");
  });

  it("renders a reload action with version-conflict feedback", () => {
    const markup = renderToStaticMarkup(
      <ConfigurationErrorFeedback
        error="Configuration changed or already exists. Reload to review the latest configuration."
        onReload={() => {}}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Configuration changed or already exists.");
    expect(markup).toContain("Reload latest configuration");
  });

  it("does not show a reload action for ordinary validation errors", () => {
    const markup = renderToStaticMarkup(
      <ConfigurationErrorFeedback
        error="Configuration failed validation. /allowed_origins: Invalid origin."
        onReload={() => {}}
      />,
    );

    expect(markup).toContain("Configuration failed validation.");
    expect(markup).not.toContain("Reload latest configuration");
  });

  it("renders server configuration failures without configuration controls", () => {
    const markup = renderToStaticMarkup(
      <ConfigurationEditor
        siteId="site-one"
        environment="production"
        result={{ kind: "unconfigured", message: "DASHBOARD_CONFIG_ADMIN_TOKEN is missing" }}
      />,
    );
    expect(markup).toContain("DASHBOARD_CONFIG_ADMIN_TOKEN is missing");
    expect(markup).not.toContain("Save capabilities");
  });
});
