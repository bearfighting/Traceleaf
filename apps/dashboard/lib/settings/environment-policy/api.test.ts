import { afterEach, describe, expect, it, vi } from "vitest";

import { saveEnvironmentPolicy } from "./api";

const payload = { enabled: true, allowed_origins: [], rate_limit_per_minute: 600 };
const existing = {
  policy: {
    site_id: "s",
    environment: "prod",
    version: 7,
    enabled: true,
    allowed_origins: [],
    keys: [],
    rate_limit_per_minute: 600,
  },
  effective_state: {
    status: "current" as const,
    stored_version: 7,
    applied_versions: { collector: 7, processor: 7, analytics_api: 7 },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("saveEnvironmentPolicy", () => {
  it("creates a policy with an encoded URL and create-only precondition", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(existing, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await saveEnvironmentPolicy("site/a", "prod west", payload, null);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/sites/site%2Fa/environments/prod%20west/ingest-policy",
      expect.objectContaining({ method: "POST", headers: expect.any(Headers), cache: "no-store" }),
    );
    const headers = fetchMock.mock.calls[0]?.[1].headers as Headers;
    expect(headers.get("If-None-Match")).toBe("*");
    expect(headers.get("If-Match")).toBeNull();
  });

  it("updates with the current version and maps conflicts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ error: { message: "Conflict." } }, { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(saveEnvironmentPolicy("s", "prod", payload, existing)).rejects.toThrow(
      "Conflict. Reload to review the latest configuration.",
    );
    expect(fetchMock.mock.calls[0]?.[1].method).toBe("PUT");
    expect((fetchMock.mock.calls[0]?.[1].headers as Headers).get("If-Match")).toBe('"7"');
  });
});
