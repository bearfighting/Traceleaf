import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getConfigurationEnvironment, loadSiteConfiguration } from "./server";

describe("Dashboard configuration server loader", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("trims the configured environment and treats blank values as missing", () => {
    vi.stubEnv("DASHBOARD_DEFAULT_ENVIRONMENT", "  staging  ");
    expect(getConfigurationEnvironment()).toBe("staging");

    vi.stubEnv("DASHBOARD_DEFAULT_ENVIRONMENT", "   ");
    expect(getConfigurationEnvironment()).toBeUndefined();
  });

  it("reports missing Admin credentials without requesting configuration", async () => {
    vi.stubEnv("DASHBOARD_CONFIG_ADMIN_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadSiteConfiguration("site-one", "production")).resolves.toEqual({
      kind: "unconfigured",
      message: "DASHBOARD_CONFIG_ADMIN_TOKEN is not configured for the Dashboard server.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads capabilities and treats a missing policy as a createable state", async () => {
    vi.stubEnv("DASHBOARD_CONFIG_ADMIN_TOKEN", "server-admin-token");
    vi.stubEnv("ANALYTICS_API_URL", "http://analytics-api:4002/");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ configuration: { version: 2 } }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadSiteConfiguration("site one", "test env")).resolves.toEqual({
      kind: "ready",
      capabilities: { configuration: { version: 2 } },
      policy: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://analytics-api:4002/v1/admin/sites/site%20one/capabilities",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "http://analytics-api:4002/v1/admin/sites/site%20one/environments/test%20env/ingest-policy",
    );
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.headers).toEqual({ Authorization: "Bearer server-admin-token" });
      expect(options.cache).toBe("no-store");
    }
  });

  it("distinguishes a missing legacy capability configuration from a service failure", async () => {
    vi.stubEnv("DASHBOARD_CONFIG_ADMIN_TOKEN", "server-admin-token");
    vi.stubEnv("ANALYTICS_API_URL", "http://analytics-api:4002");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ error: { message: "Not found." } }, { status: 404 }))
        .mockResolvedValueOnce(new Response(null, { status: 404 })),
    );

    await expect(loadSiteConfiguration("legacy-site", "production")).resolves.toEqual({
      kind: "missing_capabilities",
      message: "No capability configuration exists for this Site.",
    });
  });

  it.each([
    { status: 401, kind: "unauthorized", message: "Policy token rejected." },
    { status: 503, kind: "error", message: "Policy service unavailable." },
  ])(
    "preserves policy HTTP $status when the capability configuration is missing",
    async ({ status, kind, message }) => {
      vi.stubEnv("DASHBOARD_CONFIG_ADMIN_TOKEN", "server-admin-token");
      vi.stubEnv("ANALYTICS_API_URL", "http://analytics-api:4002");
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            Response.json(
              { error: { message: "Capability configuration missing." } },
              {
                status: 404,
              },
            ),
          )
          .mockResolvedValueOnce(Response.json({ error: { message } }, { status })),
      );

      await expect(loadSiteConfiguration("legacy-site", "production")).resolves.toEqual({
        kind,
        message,
      });
    },
  );

  it("shows API errors and maps network failures to unavailable state", async () => {
    vi.stubEnv("DASHBOARD_CONFIG_ADMIN_TOKEN", "server-admin-token");
    vi.stubEnv("ANALYTICS_API_URL", "http://analytics-api:4002");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: { message: "Admin token rejected." } }, { status: 401 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadSiteConfiguration("site-one", "production")).resolves.toEqual({
      kind: "unauthorized",
      message: "Admin token rejected.",
    });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(loadSiteConfiguration("site-one", "production")).resolves.toEqual({
      kind: "error",
      message: "Configuration service is unavailable. Try again later.",
    });
  });
});
