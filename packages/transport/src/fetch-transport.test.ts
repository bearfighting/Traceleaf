import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { FetchTransportError } from "./errors";
import { FetchTransport } from "./fetch-transport";

import type { AnalyticsEvent, PageViewEvent } from "@web-analytics/protocol-ts";

interface HttpFixture {
  request: {
    body: string;
    headers: Record<string, string>;
    method: string;
    path: string;
  };
  expected: {
    body: string;
    status: number;
  };
}

const acceptedFixture = readFixture("accepted-single-event.json");
const acceptedCharsetFixture = readFixture("accepted-charset.json");
const invalidKeyFixture = readFixture("invalid-ingest-key.json");
const rateLimitedFixture = readFixture("rate-limited.json");
const endpoint = "http://localhost:4001/v1/events";

function readFixture(name: string): HttpFixture {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../../protocol/contracts/http-ingestion/current/fixtures/${name}`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as HttpFixture;
}

function fixtureEvents(fixture: HttpFixture): readonly PageViewEvent[] {
  return (JSON.parse(fixture.request.body) as { events: PageViewEvent[] }).events;
}

const identifiedEvent: AnalyticsEvent = {
  schema_version: 1,
  event_id: "01J00000000000000000000001",
  type: "page_view",
  site_id: "site_example",
  occurred_at: 1760000000000,
  path: "/v2",
  visitor_id: "550e8400-e29b-41d4-a716-446655440000",
  context_schema_version: 1,
  context: {
    language: "en-CA",
    timezone: "unknown",
    viewport_width: "unknown",
    viewport_height: "unknown",
    screen_width: "unknown",
    screen_height: "unknown",
    user_agent: "unknown",
  },
};

function responseFor(fixture: HttpFixture): Response {
  return new Response(fixture.expected.body, {
    status: fixture.expected.status,
    headers: { "content-type": "application/json" },
  });
}

describe("FetchTransport", () => {
  it("sends identified and anonymous events in one unified request", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(responseFor(acceptedFixture));
    const transport = new FetchTransport({
      endpoint,
      ingestKey: "public-key-example",
      fetch: fetchMock,
    });
    await transport.sendBatch([...fixtureEvents(acceptedFixture), identifiedEvent]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).schema_version).toBe(1);
  });

  it("sends the canonical EventBatch request without manually setting Origin", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(responseFor(acceptedFixture));
    const transport = new FetchTransport({
      endpoint,
      ingestKey: acceptedFixture.request.headers["x-ingest-key"],
      fetch: fetchMock,
    });

    await transport.sendBatch(fixtureEvents(acceptedFixture));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(endpoint);
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ingest-Key": acceptedFixture.request.headers["x-ingest-key"],
      },
    });
    expect((init?.headers as Record<string, string>).Origin).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toEqual(JSON.parse(acceptedFixture.request.body));
  });

  it("treats the canonical accepted fixture as success", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(responseFor(acceptedFixture));
    const transport = new FetchTransport({
      endpoint,
      ingestKey: "public-key-example",
      fetch: fetchMock,
    });

    await expect(transport.sendBatch(fixtureEvents(acceptedFixture))).resolves.toBeUndefined();
  });

  it("invokes the default browser fetch with globalThis as its receiver", async () => {
    const fetchMock = vi.fn(function (this: typeof globalThis) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }

      return Promise.resolve(responseFor(acceptedFixture));
    }) as typeof globalThis.fetch;
    vi.stubGlobal("fetch", fetchMock);

    try {
      const transport = new FetchTransport({
        endpoint,
        ingestKey: "public-key-example",
      });

      await expect(transport.sendBatch(fixtureEvents(acceptedFixture))).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("accepts the canonical charset fixture body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(responseFor(acceptedCharsetFixture));
    const transport = new FetchTransport({
      endpoint,
      ingestKey: acceptedCharsetFixture.request.headers["x-ingest-key"],
      fetch: fetchMock,
    });

    await expect(
      transport.sendBatch(fixtureEvents(acceptedCharsetFixture)),
    ).resolves.toBeUndefined();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(
      JSON.parse(acceptedCharsetFixture.request.body),
    );
  });

  it("does not send an empty batch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const transport = new FetchTransport({
      endpoint,
      ingestKey: "public-key-example",
      fetch: fetchMock,
    });

    await transport.sendBatch([]);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("splits batches at 100 events while preserving event order", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(responseFor(acceptedFixture));
    const transport = new FetchTransport({
      endpoint,
      ingestKey: "public-key-example",
      fetch: fetchMock,
    });
    const events = Array.from({ length: 205 }, (_, index) => ({
      ...identifiedEvent,
      event_id: `01J00000000000000000000${String(index).padStart(2, "0")}`,
    }));

    await transport.sendBatch(events);

    const batches = fetchMock.mock.calls.map(
      ([, init]) => (JSON.parse(String(init?.body)) as { events: AnalyticsEvent[] }).events,
    );
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 5]);
    expect(batches.flat().map((event) => event.event_id)).toEqual(
      events.map((event) => event.event_id),
    );
  });

  it("splits batches by UTF-8 body size", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(responseFor(acceptedFixture));
    const transport = new FetchTransport({
      endpoint,
      ingestKey: "public-key-example",
      fetch: fetchMock,
    });
    const events = Array.from({ length: 3 }, (_, index) => ({
      ...identifiedEvent,
      event_id: `01J0000000000000000000000${index}`,
      path: `/${"é".repeat(11_000)}`,
    }));

    await transport.sendBatch(events);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const batches = fetchMock.mock.calls.map(([, init]) => String(init?.body));
    expect(batches.every((body) => new TextEncoder().encode(body).byteLength <= 65_536)).toBe(true);
    expect(
      batches.flatMap((body) =>
        (JSON.parse(body) as { events: AnalyticsEvent[] }).events.map((event) => event.event_id),
      ),
    ).toEqual(events.map((event) => event.event_id));
  });

  it("rejects an event larger than the request body limit before sending", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const transport = new FetchTransport({
      endpoint,
      ingestKey: "public-key-example",
      fetch: fetchMock,
    });
    const oversized = { ...identifiedEvent, path: `/${"x".repeat(66_000)}` };

    await expect(transport.sendBatch([oversized])).rejects.toThrow("request body limit");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, "invalid_event_batch", "collector"],
    [401, "invalid_ingest_key", "collector"],
    [403, "origin_not_allowed", "collector"],
    [413, "payload_too_large", "collector"],
    [429, "rate_limited", "collector"],
    [500, "collector_error", "collector"],
  ] as const)("maps HTTP %i with code %s", async (status, code, kind) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code, message: "fixture error" } }), {
        status,
        headers: status === 429 ? { "retry-after": "60" } : undefined,
      }),
    );
    const transport = new FetchTransport({
      endpoint,
      ingestKey: "public-key-example",
      fetch: fetchMock,
    });

    const error = await transport.sendBatch(fixtureEvents(acceptedFixture)).catch((value) => value);

    expect(error).toBeInstanceOf(FetchTransportError);
    expect(error).toMatchObject({ kind, status, code });
    if (status === 429) {
      expect(error).toMatchObject({ retryAfter: "60" });
    }
  });

  it("maps invalid-key and rate-limited canonical fixtures", async () => {
    for (const fixture of [invalidKeyFixture, rateLimitedFixture]) {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(responseFor(fixture));
      const transport = new FetchTransport({
        endpoint,
        ingestKey: "public-key-example",
        fetch: fetchMock,
      });

      await expect(transport.sendBatch(fixtureEvents(acceptedFixture))).rejects.toMatchObject({
        status: fixture.expected.status,
        code: JSON.parse(fixture.expected.body).error.code,
      });
    }
  });

  it("maps non-JSON HTTP errors without leaking the parser error", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("upstream failure", { status: 502 }));
    const transport = new FetchTransport({
      endpoint,
      ingestKey: "public-key-example",
      fetch: fetchMock,
    });

    await expect(transport.sendBatch(fixtureEvents(acceptedFixture))).rejects.toMatchObject({
      kind: "http",
      status: 502,
      code: undefined,
    });
  });

  it("maps fetch failures and does not retry", async () => {
    const failure = new Error("connection refused");
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(failure);
    const transport = new FetchTransport({
      endpoint,
      ingestKey: "public-key-example",
      fetch: fetchMock,
    });

    await expect(transport.sendBatch(fixtureEvents(acceptedFixture))).rejects.toMatchObject({
      kind: "network",
      cause: failure,
      message: "Fetch request failed: connection refused",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["http://localhost:4001", "not-a-url", "ftp://localhost:4001/v1/events"])(
    "rejects incomplete or non-HTTP endpoint %s",
    (invalidEndpoint) => {
      expect(
        () => new FetchTransport({ endpoint: invalidEndpoint, ingestKey: "public-key-example" }),
      ).toThrow(TypeError);
    },
  );
});

describe("FetchTransport keepalive", () => {
  it("sends a batch that fits within the browser budget", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(responseFor(acceptedFixture));
    const transport = new FetchTransport({
      endpoint,
      ingestKey: "keepalive-key",
      fetch: fetchMock,
    });
    await transport.sendBatch([identifiedEvent], { keepalive: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.keepalive).toBe(true);
  });

  it("rejects the whole batch when it needs multiple keepalive requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(responseFor(acceptedFixture));
    const transport = new FetchTransport({
      endpoint,
      ingestKey: "keepalive-key",
      fetch: fetchMock,
    });
    const largeEvents = Array.from(
      { length: 12 },
      (_, i) =>
        ({
          schema_version: 1,
          event_id: `01J0000000000000000000000${i}`,
          type: "custom_event",
          site_id: "site_example",
          occurred_at: 1760000000000,
          event_name: "large",
          properties: { payload: "x".repeat(6000) },
        }) as unknown as AnalyticsEvent,
    );
    await expect(transport.sendBatch(largeEvents, { keepalive: true })).rejects.toThrow(
      "Keepalive byte budget exceeded",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
