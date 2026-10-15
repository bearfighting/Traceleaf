import { FetchTransportError } from "./errors";

import type { Transport } from "@web-analytics/analytics-core";
import type { AnalyticsEvent } from "@web-analytics/protocol-ts";

const MAX_KEEPALIVE_BODY_BYTES = 60_000;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const MAX_EVENTS_PER_REQUEST = 100;

export interface FetchTransportOptions {
  endpoint: string;
  ingestKey: string;
  fetch?: typeof globalThis.fetch;
}

interface CollectorErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

export class FetchTransport implements Transport {
  private readonly endpoint: string;
  private readonly ingestKey: string;
  private readonly injectedFetch: typeof globalThis.fetch | undefined;

  constructor(options: FetchTransportOptions) {
    validateEndpoint(options.endpoint);
    if (options.ingestKey.length === 0) {
      throw new TypeError("FetchTransport ingestKey must not be empty");
    }

    this.endpoint = options.endpoint;
    this.ingestKey = options.ingestKey;
    this.injectedFetch = options.fetch;
  }

  async sendBatch(
    events: readonly AnalyticsEvent[],
    options?: { keepalive?: boolean },
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const keepalive = options?.keepalive === true;
    const maxBodyBytes = keepalive ? MAX_KEEPALIVE_BODY_BYTES : MAX_REQUEST_BODY_BYTES;
    const batches = splitEventBatches(events, maxBodyBytes);
    if (keepalive && batches.length > 1) {
      throw new Error(
        `Keepalive byte budget exceeded; batch requires ${batches.length} requests, but keepalive allows one.`,
      );
    }
    for (const batch of batches) {
      await this.sendOne(batch, keepalive);
    }
  }

  private async sendOne(events: readonly AnalyticsEvent[], keepalive: boolean): Promise<void> {
    let response: Response;
    try {
      const request = {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Ingest-Key": this.ingestKey },
        body: JSON.stringify({ schema_version: 1, events }),
        ...(keepalive ? { keepalive: true } : {}),
      };
      response = await (this.injectedFetch
        ? this.injectedFetch(this.endpoint, request)
        : globalThis.fetch(this.endpoint, request));
    } catch (cause) {
      throw new FetchTransportError(`Fetch request failed: ${errorMessage(cause)}`, {
        kind: "network",
        cause,
      });
    }
    if (response.status === 202) return;

    const body = await readErrorBody(response);
    const code = typeof body?.error?.code === "string" ? body.error.code : undefined;
    const message =
      typeof body?.error?.message === "string"
        ? body.error.message
        : `Collector returned HTTP ${response.status}`;

    throw new FetchTransportError(message, {
      kind: code ? "collector" : "http",
      status: response.status,
      code,
      retryAfter: response.headers.get("retry-after") ?? undefined,
    });
  }
}

function validateEndpoint(endpoint: string): void {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new TypeError("FetchTransport endpoint must be an absolute URL");
  }

  if (!/^https?:$/.test(parsed.protocol) || parsed.pathname !== "/v1/events") {
    throw new TypeError("FetchTransport endpoint must be an HTTP(S) /v1/events URL");
  }
}

async function readErrorBody(response: Response): Promise<CollectorErrorBody | undefined> {
  try {
    const body: unknown = await response.json();

    return isCollectorErrorBody(body) ? body : undefined;
  } catch {
    return undefined;
  }
}

function isCollectorErrorBody(value: unknown): value is CollectorErrorBody {
  return typeof value === "object" && value !== null && "error" in value;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function splitEventBatches(
  events: readonly AnalyticsEvent[],
  maxBodyBytes: number,
): readonly (readonly AnalyticsEvent[])[] {
  const batches: AnalyticsEvent[][] = [];
  let current: AnalyticsEvent[] = [];
  for (const event of events) {
    const candidate = [...current, event];
    if (candidate.length > MAX_EVENTS_PER_REQUEST || requestBodySize(candidate) > maxBodyBytes) {
      if (current.length === 0) {
        throw new Error(`Event exceeds the ${maxBodyBytes}-byte request body limit`);
      }
      batches.push(current);
      current = [event];
      if (requestBodySize(current) > maxBodyBytes) {
        throw new Error(`Event exceeds the ${maxBodyBytes}-byte request body limit`);
      }
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) batches.push(current);

  return batches;
}

function requestBodySize(events: readonly AnalyticsEvent[]): number {
  return new TextEncoder().encode(JSON.stringify({ schema_version: 1, events })).byteLength;
}
