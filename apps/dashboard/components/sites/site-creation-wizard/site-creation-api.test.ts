import { afterEach, describe, expect, it, vi } from "vitest";

import { createSite, issueReplacementKey, loadIngestPolicy } from "./site-creation-api";

const payload = {
  display_name: "Example",
  website_url: "https://example.test",
  environment: "production",
  capabilities: { page_views: true },
  allowed_origins: ["https://example.test"],
};

afterEach(() => vi.unstubAllGlobals());

describe("site creation API response interpretation", () => {
  it("distinguishes initial creation from an idempotent replay", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            site: { site_id: "site-a" },
            initial_environment: "production",
            ingest_key: { key: "secret", key_id: "key-a" },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ site: { site_id: "site-a" } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createSite(payload, "request-key")).resolves.toEqual({
      kind: "created",
      value: {
        site: { site_id: "site-a" },
        initial_environment: "production",
        ingest_key: { key: "secret", key_id: "key-a" },
      },
    });
    await expect(createSite(payload, "request-key")).resolves.toEqual({
      kind: "replayed",
      siteId: "site-a",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/sites",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "request-key" },
        body: JSON.stringify(payload),
        cache: "no-store",
      }),
    );
  });

  it("maps validation paths to form fields and preserves the API message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: "Invalid site",
              details: [{ path: "/allowed_origins/0", message: "Origin rejected" }],
            },
          }),
          { status: 422 },
        ),
      ),
    );

    await expect(createSite(payload, "request-key")).rejects.toMatchObject({
      message: "Invalid site",
      fieldErrors: { origins: "Origin rejected" },
    });
  });
});

describe("replacement key API", () => {
  it("uses policy ETag and preserves the request contract", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200, headers: { ETag: '"v2"' } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ key: "replacement-secret" }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const etag = await loadIngestPolicy("site/a", "prod env");
    await expect(issueReplacementKey("site/a", "prod env", etag)).resolves.toBe(
      "replacement-secret",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/admin/sites/site%2Fa/environments/prod%20env/ingest-policy",
      { cache: "no-store" },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/sites/site%2Fa/environments/prod%20env/ingest-keys",
      { method: "POST", headers: { "If-Match": '"v2"' }, cache: "no-store" },
    );
  });
});
