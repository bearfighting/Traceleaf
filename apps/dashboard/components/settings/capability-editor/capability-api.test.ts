import { afterEach, describe, expect, it, vi } from "vitest";

import { initializeCapabilities, saveCapabilities } from "./capability-api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("capability API", () => {
  it("initializes with a create-only precondition", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetchMock);

    await initializeCapabilities("site/one");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/sites/site%2Fone/capabilities",
      expect.objectContaining({
        method: "POST",
        headers: { "If-None-Match": "*" },
        cache: "no-store",
      }),
    );
  });

  it("saves with the current version and preserves conflict feedback", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { message: "Configuration changed or already exists." } },
          { status: 409 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveCapabilities("site-one", 12, {} as never)).rejects.toThrow(
      "Configuration changed or already exists. Reload to review the latest configuration.",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/sites/site-one/capabilities",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": '"12"' },
        cache: "no-store",
      }),
    );
  });
});
