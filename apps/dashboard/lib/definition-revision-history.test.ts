import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./analytics-api/config", () => ({ getAnalyticsApiUrl: () => "http://analytics.test" }));

import { loadDefinitionRevisionHistory } from "./definition-revision-history";

afterEach(() => vi.unstubAllGlobals());

describe("loadDefinitionRevisionHistory", () => {
  it("returns current and historical revision metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            current_definition_version: "r2",
            revisions: [
              { definition_version: "r2", revision: 2, effective_at: "2026-09-27T00:00:00Z" },
              { definition_version: "r1", revision: 1, effective_at: null },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(loadDefinitionRevisionHistory("site_alpha")).resolves.toEqual({
      kind: "ready",
      currentVersion: "r2",
      revisions: [
        { version: "r2", revision: 2, effectiveAt: "2026-09-27T00:00:00Z" },
        { version: "r1", revision: 1, effectiveAt: null },
      ],
    });
  });

  it("distinguishes no revisions from a failed request", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ revisions: [], current_definition_version: null }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(new Response("{}", { status: 503 })),
    );
    await expect(loadDefinitionRevisionHistory("site_alpha")).resolves.toEqual({
      kind: "ready",
      currentVersion: null,
      revisions: [],
    });
    await expect(loadDefinitionRevisionHistory("site_alpha")).resolves.toMatchObject({
      kind: "error",
    });
  });

  it("treats malformed revision metadata as an error instead of an empty history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ revisions: [{ definition_version: "r1" }] }), {
          status: 200,
        }),
      ),
    );
    await expect(loadDefinitionRevisionHistory("site_alpha")).resolves.toMatchObject({
      kind: "error",
    });
  });
});
