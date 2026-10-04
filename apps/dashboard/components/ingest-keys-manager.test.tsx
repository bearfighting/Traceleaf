// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { IngestKeysManager } from "./ingest-keys-manager";

import type { ConfigurationLoadResult } from "../lib/configuration-api/server";

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let testLocks: {
  request: (
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: Lock | null) => Promise<void>,
  ) => Promise<void>;
};

const policy = {
  policy: {
    site_id: "site_alpha",
    environment: "production",
    version: 1,
    enabled: true,
    allowed_origins: ["https://alpha.example"],
    keys: [{ key_id: "ik_existing", created_at: "2026-10-01T00:00:00Z" }],
    rate_limit_per_minute: 600,
  },
  effective_state: {
    status: "current" as const,
    stored_version: 1,
    applied_versions: { collector: 1, processor: 1, analytics_api: 1 },
  },
};

const loadResult = {
  kind: "ready" as const,
  capabilities: {} as never,
  policy,
} satisfies ConfigurationLoadResult;

function renderManager() {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  testLocks = {
    request: async (_name, _options, callback) => callback({} as Lock),
  };
  Object.defineProperty(navigator, "locks", { configurable: true, value: testLocks });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <IngestKeysManager siteId="site_alpha" environment="production" result={loadResult} />,
    ),
  );
}

function button(name: string): HTMLButtonElement {
  const found = [...(container?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!found) throw new Error(`Could not find button: ${name}`);

  return found;
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  router.refresh.mockReset();
  window.localStorage.clear();
  Reflect.deleteProperty(navigator, "locks");
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

describe("IngestKeysManager create recovery", () => {
  it("closes a stale revoke confirmation when a refresh shows the key is already inactive", async () => {
    const latestPolicy = {
      ...policy,
      policy: { ...policy.policy, version: 2, keys: [] },
      effective_state: { ...policy.effective_state, stored_version: 2 },
    };
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network disconnected"))
      .mockResolvedValueOnce(Response.json(latestPolicy));
    vi.stubGlobal("fetch", fetchMock);
    renderManager();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
    await act(async () => button("Revoke").click());
    expect(container?.querySelector('[role="alertdialog"]')?.textContent).toContain("ik_existing");

    await act(async () => {
      button("Revoke ik_existing").click();
      await new Promise((resolve) => setTimeout(resolve, 1));
    });

    expect(container?.querySelector('[role="alertdialog"]')).toBeNull();
    expect(container?.textContent).toContain(
      "Key ik_existing is no longer active. The revocation has completed.",
    );
    expect(container?.textContent).toContain("No active ingest keys.");
  });

  it("requires a valid active key list before clearing an unknown-outcome marker", async () => {
    const marker = "ingest-keys:site_alpha:production:outcome-unknown";
    window.localStorage.setItem(marker, "unknown");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ policy: { keys: [] } }))
      .mockResolvedValueOnce(Response.json(policy));
    vi.stubGlobal("fetch", fetchMock);
    renderManager();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
    await act(async () => {
      button("Refresh active key list").click();
      await new Promise((resolve) => setTimeout(resolve, 1));
    });

    expect(container?.textContent).toContain("active key list response could not be verified");
    expect(button("I checked the key list").disabled).toBe(true);
    expect(button("Create replacement key").disabled).toBe(true);
    expect(window.localStorage.getItem(marker)).toBe("unknown");

    await act(async () => {
      button("Refresh active key list").click();
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
    expect(button("I checked the key list").disabled).toBe(false);

    await act(async () => button("I checked the key list").click());
    expect(window.localStorage.getItem(marker)).toBe(null);
    expect(button("Create replacement key").disabled).toBe(false);
  });

  it("does not clear a review marker while another tab holds the creation lock", async () => {
    const marker = "ingest-keys:site_alpha:production:outcome-unknown";
    window.localStorage.setItem(marker, "other-tab-request");
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(policy));
    vi.stubGlobal("fetch", fetchMock);
    renderManager();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
    await act(async () => {
      button("Refresh active key list").click();
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
    testLocks.request = async (_name, _options, callback) => callback(null);

    await act(async () => button("I checked the key list").click());

    expect(window.localStorage.getItem(marker)).toBe("other-tab-request");
    expect(button("I checked the key list").disabled).toBe(false);
    expect(container?.textContent).toContain("Another tab is still handling a key request");
    expect(button("Create replacement key").disabled).toBe(true);
  });

  it("keeps the review marker when a successful response has incomplete key metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ key: "one-time-secret-value" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    renderManager();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
    await act(async () => {
      button("Create replacement key").click();
      await new Promise((resolve) => setTimeout(resolve, 1));
    });

    expect(container?.textContent).toContain("could not be verified");
    expect(container?.textContent).not.toContain("one-time-secret-value");
    expect(
      window.localStorage.getItem("ingest-keys:site_alpha:production:outcome-unknown"),
    ).not.toBeNull();
    expect(button("Create replacement key").disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a confirmed secret visible and blocks another create until list refresh succeeds", async () => {
    const created = {
      key: "one-time-secret-value",
      metadata: { key_id: "ik_created", created_at: "2026-10-02T00:00:00Z" },
      effective_state: { ...policy.effective_state, stored_version: 2 },
    };
    const refreshedPolicy = {
      ...policy,
      policy: {
        ...policy.policy,
        version: 2,
        keys: [...policy.policy.keys, created.metadata],
      },
      effective_state: created.effective_state,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(created, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ error: { message: "Unavailable" } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json(refreshedPolicy));
    vi.stubGlobal("fetch", fetchMock);
    renderManager();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
    await act(async () => {
      button("Create replacement key").click();
      await new Promise((resolve) => setTimeout(resolve, 1));
    });

    expect(container?.textContent).toContain("one-time-secret-value");
    expect(container?.textContent).toContain("Key created successfully");
    expect(container?.textContent).toContain("ik_created");
    const secretAnnouncement = container?.querySelector('[role="status"]');
    expect(secretAnnouncement?.textContent).toContain("Ingest Key created.");
    expect(secretAnnouncement?.textContent).toContain("Copy this key now");
    expect(secretAnnouncement?.textContent).not.toContain("one-time-secret-value");
    expect(button("Create replacement key").disabled).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/ingest-keys")),
    ).toHaveLength(1);
    expect(window.localStorage.getItem("ingest-keys:site_alpha:production:outcome-unknown")).toBe(
      null,
    );

    await act(async () => {
      button("Refresh active key list").click();
      await new Promise((resolve) => setTimeout(resolve, 1));
    });

    expect(button("Create replacement key").disabled).toBe(false);
    expect(container?.textContent).toContain("one-time-secret-value");
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/ingest-keys")),
    ).toHaveLength(1);
  });
});
