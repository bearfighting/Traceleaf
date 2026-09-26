import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { proxyConfigurationRequest } from "./proxy";

describe("configuration BFF proxy", () => {
  beforeEach(() => {
    process.env.DASHBOARD_SITES = "site-one";
    process.env.DASHBOARD_DEFAULT_SITE = "site-one";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DASHBOARD_CONFIG_ADMIN_TOKEN;
    delete process.env.DASHBOARD_SITES;
    delete process.env.DASHBOARD_DEFAULT_SITE;
    delete process.env.ANALYTICS_API_URL;
  });

  it("forwards the admin credential and version precondition only upstream", async () => {
    process.env.DASHBOARD_CONFIG_ADMIN_TOKEN = "deployment-secret";
    process.env.ANALYTICS_API_URL = "http://analytics-api:4002";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ saved: true }, { status: 200, headers: { ETag: '"2"' } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyConfigurationRequest(
      new Request("http://dashboard.test/api/admin/sites/site-one/capabilities", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": '"1"',
          Origin: "http://dashboard.test",
        },
        body: JSON.stringify({ capabilities: {} }),
      }),
      "/v1/admin/sites/site-one/capabilities",
      "PUT",
      "site-one",
    );
    const [, init] = fetchMock.mock.calls[0];
    const upstreamHeaders = new Headers(init?.headers);
    expect(upstreamHeaders.get("Authorization")).toBe("Bearer deployment-secret");
    expect(upstreamHeaders.get("If-Match")).toBe('"1"');
    expect(response.headers.get("ETag")).toBe('"2"');
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toContain("deployment-secret");
  });

  it("uses the public host forwarded by a trusted TLS-terminating proxy", async () => {
    process.env.DASHBOARD_CONFIG_ADMIN_TOKEN = "deployment-secret";
    process.env.ANALYTICS_API_URL = "http://analytics-api:4002";
    const fetchMock = vi.fn(async () => Response.json({ saved: true }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyConfigurationRequest(
      new Request("http://dashboard:3000/api/admin/sites/site-one/capabilities", {
        method: "PUT",
        headers: {
          Origin: "https://analytics.example.test",
          "X-Forwarded-Host": "analytics.example.test",
          "X-Forwarded-Proto": "https",
        },
        body: "{}",
      }),
      "/v1/admin/sites/site-one/capabilities",
      "PUT",
      "site-one",
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin mutations before contacting the API", async () => {
    process.env.DASHBOARD_CONFIG_ADMIN_TOKEN = "deployment-secret";
    process.env.ANALYTICS_API_URL = "http://analytics-api:4002";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyConfigurationRequest(
      new Request("http://dashboard.test/api/admin/sites/site-one/capabilities", {
        method: "PUT",
        headers: { Origin: "http://attacker.test" },
      }),
      "/v1/admin/sites/site-one/capabilities",
      "PUT",
      "site-one",
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects sites outside the Dashboard allowlist before contacting the API", async () => {
    process.env.DASHBOARD_CONFIG_ADMIN_TOKEN = "deployment-secret";
    process.env.ANALYTICS_API_URL = "http://analytics-api:4002";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyConfigurationRequest(
      new Request("http://dashboard.test/api/admin/sites/site-two/capabilities"),
      "/v1/admin/sites/site-two/capabilities",
      "GET",
      "site-two",
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "site_not_allowed",
        message: "The requested site is not configured for this Dashboard.",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the server admin credential is missing", async () => {
    process.env.ANALYTICS_API_URL = "http://analytics-api:4002";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyConfigurationRequest(
      new Request("http://dashboard.test/api/admin/sites/site-one/capabilities"),
      "/v1/admin/sites/site-one/capabilities",
      "GET",
      "site-one",
    );
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
