import { afterEach, describe, expect, it, vi } from "vitest";

import { createIngestKey, fetchIngestPolicy, revokeIngestKey } from "./api";

const siteId = "site/alpha";
const environment = "preview env";
const policy = {
  policy: {
    site_id: siteId,
    environment,
    version: 4,
    enabled: true,
    allowed_origins: ["https://alpha.example"],
    keys: [{ key_id: "ik_existing", created_at: "2026-10-01T00:00:00Z" }],
    rate_limit_per_minute: 600,
  },
  effective_state: {
    status: "current",
    stored_version: 4,
    applied_versions: { collector: 4, processor: 4, analytics_api: 4 },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("Ingest Keys API", () => {
  it("fetches the active policy from the encoded Dashboard route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(policy));
    vi.stubGlobal("fetch", fetchMock);

    await fetchIngestPolicy(siteId, environment);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/sites/site%2Falpha/environments/preview%20env/ingest-policy",
      { cache: "no-store" },
    );
  });

  it("creates keys with POST and the current policy version", async () => {
    const created = {
      key: "one-time-secret",
      metadata: { key_id: "ik_created", created_at: "2026-10-02T00:00:00Z" },
      effective_state: policy.effective_state,
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(created, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await createIngestKey(siteId, environment, 4);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/sites/site%2Falpha/environments/preview%20env/ingest-keys",
      { method: "POST", headers: { "If-Match": '"4"' }, cache: "no-store" },
    );
  });

  it("revokes keys with DELETE and reports server errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ error: { message: "Policy changed" } }, { status: 412 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(revokeIngestKey(siteId, environment, "key/one", 4)).rejects.toThrow(
      "Policy changed",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/sites/site%2Falpha/environments/preview%20env/ingest-keys/key%2Fone",
      { method: "DELETE", headers: { "If-Match": '"4"' }, cache: "no-store" },
    );
  });
});
