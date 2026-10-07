import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSiteManagementClient, loadSiteDirectory } from "./client";

const site = {
  site_id: "site_alpha",
  display_name: "Alpha",
  website_url: "https://alpha.example",
  lifecycle_status: "active",
  setup_status: "ready",
  missing_requirements: [],
  version: 1,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Site Management client", () => {
  it("fetches every cursor page without caching and keeps credentials server-side", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ items: [site], next_cursor: "cursor-2" }))
      .mockResolvedValueOnce(Response.json({ items: [], next_cursor: null }));
    const client = createSiteManagementClient({
      baseUrl: "http://analytics-api:4002/",
      token: "server-token",
      fetch: fetchMock,
    });

    await expect(client.listSites()).resolves.toEqual([site]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://analytics-api:4002/v1/admin/sites?limit=100",
      "http://analytics-api:4002/v1/admin/sites?limit=100&cursor=cursor-2",
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer server-token");
      expect(init.cache).toBe("no-store");
    }
  });

  it("loads Site detail and creates with Idempotency-Key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ site }))
      .mockResolvedValueOnce(
        Response.json(
          {
            site,
            initial_environment: "production",
            ingest_key: { key: "a".repeat(43), key_id: "ik_12345678" },
          },
          { status: 201 },
        ),
      );
    const client = createSiteManagementClient({
      baseUrl: "http://analytics-api:4002",
      token: "server-token",
      fetch: fetchMock,
    });
    await expect(client.getSite("site/alpha")).resolves.toEqual(site);
    await expect(
      client.createSite(
        {
          display_name: "Alpha",
          website_url: "https://alpha.example",
          environment: "production",
          allowed_origins: ["https://alpha.example"],
        },
        "create-request-1",
      ),
    ).resolves.toEqual({
      kind: "created",
      site,
      initial_environment: "production",
      ingest_key: { key: "a".repeat(43), key_id: "ik_12345678" },
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://analytics-api:4002/v1/admin/sites/site%2Falpha",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
    });
    const createHeaders = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(createHeaders.get("Authorization")).toBe("Bearer server-token");
    expect(createHeaders.get("Idempotency-Key")).toBe("create-request-1");
    expect(createHeaders.get("Content-Type")).toBe("application/json");
  });

  it("distinguishes a metadata-only idempotent replay from the first create", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ site }, { status: 200 }));
    const client = createSiteManagementClient({
      baseUrl: "http://analytics-api:4002",
      token: "server-token",
      fetch: fetchMock,
    });

    await expect(
      client.createSite(
        {
          display_name: "Alpha",
          website_url: "https://alpha.example",
          environment: "production",
          allowed_origins: ["https://alpha.example"],
        },
        "create-request-1",
      ),
    ).resolves.toEqual({ kind: "replayed", site });
  });

  it("rejects a first-create response without the required one-time key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ site, initial_environment: "production" }, { status: 201 }),
      );
    const client = createSiteManagementClient({
      baseUrl: "http://analytics-api:4002",
      token: "server-token",
      fetch: fetchMock,
    });

    await expect(
      client.createSite(
        {
          display_name: "Alpha",
          website_url: "https://alpha.example",
          environment: "production",
          allowed_origins: ["https://alpha.example"],
        },
        "create-request-1",
      ),
    ).rejects.toMatchObject({ kind: "response", status: 201 });
  });

  it("distinguishes unconfigured and unauthorized directory states", async () => {
    vi.stubEnv("DASHBOARD_CONFIG_ADMIN_TOKEN", "");
    await expect(loadSiteDirectory()).resolves.toMatchObject({ kind: "unconfigured" });

    vi.stubEnv("DASHBOARD_CONFIG_ADMIN_TOKEN", "bad-token");
    vi.stubEnv("ANALYTICS_API_URL", "http://analytics-api:4002");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: { message: "Rejected" } }, { status: 401 })),
    );
    await expect(loadSiteDirectory()).resolves.toEqual({
      kind: "unauthorized",
      message: "Rejected",
    });
  });

  it("maps network failures and invalid responses to unavailable", async () => {
    vi.stubEnv("DASHBOARD_CONFIG_ADMIN_TOKEN", "admin-token");
    vi.stubEnv("ANALYTICS_API_URL", "http://analytics-api:4002");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(loadSiteDirectory()).resolves.toMatchObject({ kind: "unavailable" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ items: [null], next_cursor: null })),
    );
    await expect(loadSiteDirectory()).resolves.toMatchObject({ kind: "unavailable" });
  });
});
