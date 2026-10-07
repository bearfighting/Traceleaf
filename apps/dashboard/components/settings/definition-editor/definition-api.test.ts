import { afterEach, describe, expect, it, vi } from "vitest";

import { DefinitionRequestError, loadLatestDefinitions, saveDefinitions } from "./definition-api";

afterEach(() => vi.unstubAllGlobals());

const definitions = {
  schema_version: 1 as const,
  site_id: "site/one",
  revision: 2,
  definition_version: "definitions-v2",
  effective_at: null,
  conversions: [],
  funnels: [],
};

describe("definition API", () => {
  it("loads the encoded site URL without caching", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(definitions)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadLatestDefinitions("site/one")).resolves.toEqual(definitions);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/sites/site%2Fone/conversion-funnel-definitions",
      { method: "GET", cache: "no-store" },
    );
  });

  it.each([
    [undefined, "POST", { "If-None-Match": "*" }],
    [7, "PUT", { "If-Match": '"7"' }],
  ] as const)(
    "saves with the expected conditional request for revision %s",
    async (revision, method, conditional) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(definitions), { status: 201 }));
      vi.stubGlobal("fetch", fetchMock);
      const draft = { conversions: [], funnels: [] };
      await expect(saveDefinitions("site/one", revision, draft)).resolves.toEqual(definitions);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/sites/site%2Fone/conversion-funnel-definitions",
        {
          method,
          headers: { "Content-Type": "application/json", ...conditional },
          body: JSON.stringify(draft),
          cache: "no-store",
        },
      );
    },
  );

  it("passes successful 200 responses through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(definitions))));
    await expect(saveDefinitions("site", 2, { conversions: [], funnels: [] })).resolves.toEqual(
      definitions,
    );
  });

  it("maps HTTP errors, classifies conflicts, and handles malformed bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Revision conflict" } }), {
          status: 409,
        }),
      ),
    );
    await expect(loadLatestDefinitions("site")).rejects.toMatchObject({
      message: expect.stringContaining("Revision conflict"),
      revisionConflict: true,
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 500 })));
    await expect(loadLatestDefinitions("site")).rejects.toBeInstanceOf(DefinitionRequestError);
  });

  it("preserves network failures", async () => {
    const failure = new Error("offline");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));
    await expect(loadLatestDefinitions("site")).rejects.toBe(failure);
  });
});
