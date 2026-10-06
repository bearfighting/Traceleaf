// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerState = vi.hoisted(() => ({ query: "" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(routerState.query),
}));

import { SiteCreationWizard } from "./site-creation-wizard";

const manifest = [
  { id: "page_views", status: "implemented", depends_on: [] },
  { id: "browser_context", status: "implemented", depends_on: ["page_views"] },
];

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderWizard() {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<SiteCreationWizard manifest={manifest} />));
}

function clickButton(name: string) {
  const button = [...(container?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!button) throw new Error(`Could not find button: ${name}`);
  act(() => button.click());
}

function fillInput(labelText: string, value: string) {
  const label = [...(container?.querySelectorAll("label") ?? [])].find((candidate) =>
    candidate.textContent?.includes(labelText),
  );
  const input = label?.querySelector("input");
  if (!input) throw new Error(`Could not find input: ${labelText}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function advanceToReview() {
  fillInput("Site name", "Example Site");
  fillInput("Website URL", "https://example.test/docs");
  clickButton("Continue");
  clickButton("Continue");
  clickButton("Continue");
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  routerState.query = "";
  window.history.replaceState(null, "", "/");
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("SiteCreationWizard result lifecycle", () => {
  it("keeps the suggested Origin synchronized while preserving manually added Origins", () => {
    renderWizard();
    fillInput("Site name", "Example Site");
    fillInput("Website URL", "https://www.e");
    fillInput("Website URL", "https://www.example.test/docs");
    clickButton("Continue");

    fillInput("Allowed Origins", "https://docs.example.test");
    clickButton("Add Origin");
    clickButton("Back");
    fillInput("Website URL", "https://www.other.example.test/app");
    clickButton("Continue");

    const origins = [...(container?.querySelectorAll("li code") ?? [])].map(
      (element) => element.textContent,
    );
    expect(origins).toEqual(["https://docs.example.test", "https://www.other.example.test"]);
    expect(origins).not.toContain("https://www.e");
    expect(origins).not.toContain("https://www.example.test");
  });

  it("preserves form values and attaches JSON Pointer validation details to fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              message: "Configuration failed validation.",
              details: [
                {
                  path: "/display_name",
                  code: "invalid_display_name",
                  message: "Name is not accepted.",
                },
              ],
            },
          },
          { status: 422 },
        ),
      ),
    );
    renderWizard();
    advanceToReview();
    await act(async () => {
      clickButton("Create Site");
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("name: Name is not accepted.");
    clickButton("Back");
    clickButton("Back");
    clickButton("Back");
    const nameInput = [...(container?.querySelectorAll("label") ?? [])]
      .find((label) => label.textContent?.includes("Site name"))
      ?.querySelector("input");
    expect(nameInput?.value).toBe("Example Site");
  });

  it("shows a first-create key only in the result view and keeps it out of the URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            site: { site_id: "site_example" },
            initial_environment: "production",
            ingest_key: { key: "A".repeat(43), key_id: "ik_example1234" },
          },
          { status: 201 },
        ),
      ),
    );
    renderWizard();
    advanceToReview();
    await act(async () => {
      clickButton("Create Site");
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Site created");
    expect(container?.textContent).toContain("site_example");
    expect(container?.textContent).toContain("A".repeat(43));
    expect(window.location.search).not.toContain("A".repeat(43));
    expect(window.location.search).toContain("site_example");
    expect(container?.textContent).toContain("NEXT_PUBLIC_ANALYTICS_ENDPOINT");
    expect(container?.textContent).not.toContain("NEXT_PUBLIC_ANALYTICS_ENVIRONMENT");
    const settingsLink = container?.querySelector(
      'a[href="/dashboard/settings/overview?site_id=site_example&environment=production"]',
    );
    expect(settingsLink?.textContent).toContain("View connection status in Settings");
    expect(settingsLink?.getAttribute("target")).toBe("_blank");
    expect(settingsLink?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("treats a 200 idempotent replay as metadata only and does not show a credential", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ site: { site_id: "site_example" } }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderWizard();
    advanceToReview();
    await act(async () => {
      clickButton("Create Site");
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("original key cannot be recovered");
    expect(container?.textContent).toContain("Create replacement key");
    expect(container?.textContent).not.toContain("One-time Ingest Key");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reuses the idempotency key for the same payload and replaces it when the payload changes", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection reset"))
      .mockRejectedValueOnce(new Error("Connection reset again"))
      .mockResolvedValueOnce(Response.json({ site: { site_id: "site_changed" } }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("first-key")
      .mockReturnValueOnce("changed-key");
    renderWizard();
    advanceToReview();

    await act(async () => {
      clickButton("Create Site");
      await Promise.resolve();
    });
    await act(async () => {
      clickButton("Create Site");
      await Promise.resolve();
    });

    const firstRequest = fetchMock.mock.calls[0];
    const retryRequest = fetchMock.mock.calls[1];
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retryRequest[0]).toBe(firstRequest[0]);
    expect(retryRequest[1]?.body).toBe(firstRequest[1]?.body);
    expect(retryRequest[1]?.headers).toEqual(firstRequest[1]?.headers);
    expect(retryRequest[1]?.headers).toMatchObject({ "Idempotency-Key": "first-key" });

    clickButton("Back");
    clickButton("Back");
    clickButton("Back");
    fillInput("Website URL", "https://changed.example.test/docs");
    clickButton("Continue");
    clickButton("Continue");
    clickButton("Continue");
    await act(async () => {
      clickButton("Create Site");
      await Promise.resolve();
    });

    const changedRequest = fetchMock.mock.calls[2];
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(changedRequest[1]?.body).not.toBe(firstRequest[1]?.body);
    expect(changedRequest[1]?.headers).toMatchObject({ "Idempotency-Key": "changed-key" });
  });

  it("ignores a repeated submit while the create request is pending", async () => {
    let resolveRequest!: (response: Response) => void;
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => (resolveRequest = resolve)),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("single-key");
    renderWizard();
    advanceToReview();

    act(() => {
      clickButton("Create Site");
      clickButton("Create Site");
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ "Idempotency-Key": "single-key" });
    resolveRequest(Response.json({ site: { site_id: "site_example" } }, { status: 200 }));
    await act(async () => await Promise.resolve());
  });

  it("refresh recovery displays no original key and makes no request until explicit action", () => {
    routerState.query = "site_id=site_example&environment=production";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderWizard();

    expect(container?.textContent).toContain("original key is no longer available");
    expect(container?.textContent).toContain("Create replacement key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restores the requested site and environment from the query string without fetching", () => {
    routerState.query = "site_id=site%2Fexample&environment=preview%20west";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderWizard();

    expect(container?.textContent).toContain("site/example");
    expect(container?.textContent).toContain("preview west");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reloads the replacement review marker when the restored identity changes", () => {
    window.localStorage.setItem(
      "site-onboarding:site_second:preview:replacement-key-outcome-unknown",
      "unknown",
    );
    routerState.query = "site_id=site_first&environment=production";
    renderWizard();

    const firstIdentityButton = [...(container?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent?.includes("Create replacement key"),
    );
    expect(firstIdentityButton?.disabled).toBe(false);

    routerState.query = "site_id=site_second&environment=preview";
    act(() => {
      root?.render(<SiteCreationWizard manifest={manifest} />);
    });

    const secondIdentityButton = [...(container?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent?.includes("Review key status in Settings"),
    );
    expect(secondIdentityButton?.disabled).toBe(true);
    expect(container?.textContent).toContain("I reviewed the key list");
    expect(
      window.localStorage.getItem(
        "site-onboarding:site_second:preview:replacement-key-outcome-unknown",
      ),
    ).toBe("unknown");
  });

  it("disables replacement issuance after a key is created", async () => {
    routerState.query = "site_id=site_example&environment=production";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 200, headers: { ETag: '"4"' } }))
      .mockResolvedValueOnce(
        Response.json({ key: "B".repeat(43) }, { status: 201, headers: { ETag: '"5"' } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderWizard();

    await act(async () => {
      clickButton("Create replacement key");
      await Promise.resolve();
      await Promise.resolve();
    });

    const issueButton = [...(container?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent?.includes("Replacement key issued"),
    );
    expect(issueButton?.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container?.textContent).toContain("B".repeat(43));
    expect(window.localStorage.length).toBe(0);
  });

  it("does not create an environment policy when none exists", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ error: { message: "Not found." } }, { status: 404 }));
    routerState.query = "site_id=site_example&environment=missing";
    vi.stubGlobal("fetch", fetchMock);
    renderWizard();

    await act(async () => {
      clickButton("Create replacement key");
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
    expect(container?.textContent).toContain("Configure the environment explicitly in Settings");
    expect(window.localStorage.length).toBe(0);
  });

  it("does not send the replacement-key POST when storage cannot save the unknown marker", async () => {
    routerState.query = "site_id=site_example&environment=production";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 200, headers: { ETag: '"4"' } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage disabled");
    });
    renderWizard();

    await act(async () => {
      clickButton("Create replacement key");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain("ingest-policy");
    expect(container?.textContent).toContain("Enable site storage");
    expect(container?.textContent).not.toContain("server may have issued a key");
  });

  it("clears review and permits another attempt after a malformed 4xx replacement response", async () => {
    routerState.query = "site_id=site_example&environment=production";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 200, headers: { ETag: '"4"' } }))
      .mockResolvedValueOnce(new Response("not-json", { status: 409 }))
      .mockResolvedValueOnce(Response.json({}, { status: 200, headers: { ETag: '"4"' } }))
      .mockResolvedValueOnce(Response.json({ key: "C".repeat(43) }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    renderWizard();

    await act(async () => {
      clickButton("Create replacement key");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.localStorage.length).toBe(0);
    expect(container?.textContent).not.toContain("server may have issued a key");
    const firstRetryButton = [...(container?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent?.includes("Create replacement key"),
    );
    expect(firstRetryButton?.disabled).toBe(false);

    await act(async () => {
      clickButton("Create replacement key");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1][0]).toContain("ingest-keys");
    expect(fetchMock.mock.calls[1][1]?.method).toBe("POST");
    expect(container?.textContent).toContain("C".repeat(43));
  });

  it.each([
    ["malformed success", new Response("not-json", { status: 201 })],
    ["missing key", Response.json({}, { status: 201 })],
    ["malformed server error", new Response("not-json", { status: 503 })],
  ])("keeps review and blocks retry after a %s replacement response", async (_case, response) => {
    routerState.query = "site_id=site_example&environment=production";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 200, headers: { ETag: '"4"' } }))
      .mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetchMock);
    renderWizard();

    await act(async () => {
      clickButton("Create replacement key");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(window.localStorage.length).toBe(1);
    expect(
      window.localStorage.getItem(
        "site-onboarding:site_example:production:replacement-key-outcome-unknown",
      ),
    ).toBe("unknown");
    expect(container?.textContent).toContain("server may have issued a key");
    const retryButton = [...(container?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent?.includes("Review key status in Settings"),
    );
    expect(retryButton?.disabled).toBe(true);
  });

  it("blocks retry after an ambiguous key response and remembers the pending review", async () => {
    routerState.query = "site_id=site_example&environment=production";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 200, headers: { ETag: '"4"' } }))
      .mockRejectedValueOnce(new Error("Connection reset"));
    vi.stubGlobal("fetch", fetchMock);
    renderWizard();

    await act(async () => {
      clickButton("Create replacement key");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container?.textContent).toContain("server may have issued a key");
    expect(window.localStorage.length).toBe(1);

    act(() => root?.unmount());
    root = undefined;
    container?.remove();
    container = undefined;
    renderWizard();

    const recoveryContainer = document.querySelector<HTMLElement>(
      '[aria-label="Site creation result"]',
    );
    const reviewButton = [...(recoveryContainer?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent?.includes("Review key status in Settings"),
    );
    expect(reviewButton?.disabled).toBe(true);
    expect(recoveryContainer?.textContent).toContain("I reviewed the key list");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
