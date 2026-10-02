import "server-only";

import { AnalyticsApiClientError } from "../analytics-api/errors";
import { getSiteManagementApiUrl } from "./config";

import type {
  CapabilityResponse,
  CreatedIngestKey,
  DefinitionSetResponse,
  IngestPolicyResponse,
} from "../configuration-api/types";

export type SiteLifecycleStatus = "active" | "archived";
export type SiteSetupStatus = "ready" | "needs_attention";
export type SiteMissingRequirement =
  "display_name" | "website_url" | "page_views" | "environment_ingest_configuration";

export interface ManagedSite {
  site_id: string;
  display_name: string | null;
  website_url: string | null;
  lifecycle_status: SiteLifecycleStatus;
  setup_status: SiteSetupStatus;
  missing_requirements: SiteMissingRequirement[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface SiteListResponse {
  items: ManagedSite[];
  next_cursor: string | null;
}

export interface SiteCreateRequest {
  display_name: string;
  website_url: string;
  environment: string;
  capabilities?: Record<string, boolean>;
  allowed_origins: string[];
}

export type SiteCreateResult =
  | {
      kind: "created";
      site: ManagedSite;
      initial_environment: string;
      ingest_key: { key: string; key_id: string };
    }
  | { kind: "replayed"; site: ManagedSite };

export interface SiteCreateResponse {
  site: ManagedSite;
  initial_environment: string;
  ingest_key: { key: string; key_id: string };
}

export interface CapabilityUpdateRequest {
  capabilities: Record<string, { enabled: boolean; settings: Record<string, never> }>;
}

export interface IngestPolicyUpdateRequest {
  enabled: boolean;
  allowed_origins: string[];
  rate_limit_per_minute: number;
}

export interface DefinitionSetUpdateRequest {
  conversions: DefinitionSetResponse["conversions"];
  funnels: DefinitionSetResponse["funnels"];
}

export interface SiteManagementClient {
  listSites(): Promise<ManagedSite[]>;
  getSite(siteId: string): Promise<ManagedSite>;
  createSite(request: SiteCreateRequest, idempotencyKey: string): Promise<SiteCreateResult>;
  getCapabilities(siteId: string): Promise<CapabilityResponse>;
  updateCapabilities(
    siteId: string,
    body: CapabilityUpdateRequest,
    ifMatch: string,
  ): Promise<CapabilityResponse>;
  getIngestPolicy(siteId: string, environment: string): Promise<IngestPolicyResponse>;
  updateIngestPolicy(
    siteId: string,
    environment: string,
    body: IngestPolicyUpdateRequest,
    ifMatch: string,
  ): Promise<IngestPolicyResponse>;
  createIngestPolicy(
    siteId: string,
    environment: string,
    body: IngestPolicyUpdateRequest,
  ): Promise<IngestPolicyResponse>;
  createIngestKey(siteId: string, environment: string, ifMatch: string): Promise<CreatedIngestKey>;
  revokeIngestKey(
    siteId: string,
    environment: string,
    keyId: string,
    ifMatch: string,
  ): Promise<IngestPolicyResponse>;
  getDefinitions(siteId: string): Promise<DefinitionSetResponse | null>;
  createDefinitions(
    siteId: string,
    body: DefinitionSetUpdateRequest,
  ): Promise<DefinitionSetResponse>;
  updateDefinitions(
    siteId: string,
    body: DefinitionSetUpdateRequest,
    ifMatch: string,
  ): Promise<DefinitionSetResponse>;
}

export type SiteDirectoryResult =
  | { kind: "ready"; sites: ManagedSite[] }
  | { kind: "unconfigured"; message: string }
  | { kind: "unauthorized"; message: string }
  | { kind: "unavailable"; message: string };

const SITE_PAGE_LIMIT = 100;

export function createSiteManagementClient(options: {
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}): SiteManagementClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const injectedFetch = options.fetch ?? globalThis.fetch;

  async function requestWithStatus(
    path: string,
    init: RequestInit = {},
  ): Promise<{ body: unknown; status: number }> {
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${options.token}`);
      headers.set("Accept", "application/json");
      if (init.body !== undefined) headers.set("Content-Type", "application/json");
      response = await injectedFetch(`${baseUrl}${path}`, {
        ...init,
        headers,
        cache: "no-store",
      });
    } catch (cause) {
      throw new AnalyticsApiClientError("Site Management service is unavailable.", {
        kind: "network",
        cause,
      });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new AnalyticsApiClientError("Site Management returned an invalid response.", {
        kind: response.ok ? "response" : "http",
        status: response.status,
        cause,
      });
    }
    if (!response.ok) {
      const apiMessage = readApiMessage(body);

      throw new AnalyticsApiClientError(apiMessage ?? "Site Management request failed.", {
        kind: "http",
        status: response.status,
        code: readApiCode(body),
      });
    }

    return { body, status: response.status };
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await requestWithStatus(path, init);
    return response.body as T;
  }

  return {
    async listSites() {
      const sites: ManagedSite[] = [];
      const cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ limit: String(SITE_PAGE_LIMIT) });
        if (cursor) query.set("cursor", cursor);
        const page = validateSiteList(await request<unknown>(`/v1/admin/sites?${query}`));
        sites.push(...page.items);
        cursor = page.next_cursor;
        if (cursor && cursors.has(cursor)) {
          throw new AnalyticsApiClientError("Site Management returned a repeated page cursor.", {
            kind: "response",
          });
        }
        if (cursor) cursors.add(cursor);
      } while (cursor);

      return sites;
    },
    async getSite(siteId) {
      const result = await request<unknown>(`/v1/admin/sites/${encodeURIComponent(siteId)}`);
      if (!isRecord(result) || !isManagedSite(result.site)) {
        throw new AnalyticsApiClientError("Site Management returned an invalid Site response.", {
          kind: "response",
        });
      }

      return result.site;
    },
    async createSite(requestBody, idempotencyKey) {
      const response = await requestWithStatus("/v1/admin/sites", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(requestBody),
      });
      if (!isRecord(response.body) || !isManagedSite(response.body.site)) {
        throw new AnalyticsApiClientError("Site Management returned an invalid Site response.", {
          kind: "response",
        });
      }

      if (response.status === 200) {
        if ("ingest_key" in response.body || "initial_environment" in response.body) {
          throw new AnalyticsApiClientError(
            "Site Management returned one-time credentials in a replay response.",
            { kind: "response", status: response.status },
          );
        }

        return { kind: "replayed", site: response.body.site };
      }

      if (
        response.status !== 201 ||
        typeof response.body.initial_environment !== "string" ||
        response.body.initial_environment.length === 0 ||
        !isRecord(response.body.ingest_key) ||
        typeof response.body.ingest_key.key !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(response.body.ingest_key.key) ||
        typeof response.body.ingest_key.key_id !== "string" ||
        !/^ik_[A-Za-z0-9_-]{8,64}$/.test(response.body.ingest_key.key_id)
      ) {
        throw new AnalyticsApiClientError(
          "Site Management returned an invalid first-create response.",
          { kind: "response", status: response.status },
        );
      }

      return {
        kind: "created",
        site: response.body.site,
        initial_environment: response.body.initial_environment,
        ingest_key: response.body.ingest_key as SiteCreateResponse["ingest_key"],
      };
    },
    getCapabilities: (siteId) =>
      request<CapabilityResponse>(`/v1/admin/sites/${encodeURIComponent(siteId)}/capabilities`),
    updateCapabilities: (siteId, body, ifMatch) =>
      request<CapabilityResponse>(`/v1/admin/sites/${encodeURIComponent(siteId)}/capabilities`, {
        method: "PUT",
        headers: { "If-Match": ifMatch },
        body: JSON.stringify(body),
      }),
    getIngestPolicy: (siteId, environment) =>
      request<IngestPolicyResponse>(policyPath(siteId, environment)),
    updateIngestPolicy: (siteId, environment, body, ifMatch) =>
      request<IngestPolicyResponse>(policyPath(siteId, environment), {
        method: "PUT",
        headers: { "If-Match": ifMatch },
        body: JSON.stringify(body),
      }),
    createIngestPolicy: (siteId, environment, body) =>
      request<IngestPolicyResponse>(policyPath(siteId, environment), {
        method: "POST",
        headers: { "If-None-Match": "*" },
        body: JSON.stringify(body),
      }),
    createIngestKey: (siteId, environment, ifMatch) =>
      request<CreatedIngestKey>(`${policyPath(siteId, environment)}/ingest-keys`, {
        method: "POST",
        headers: { "If-Match": ifMatch },
      }),
    revokeIngestKey: (siteId, environment, keyId, ifMatch) =>
      request<IngestPolicyResponse>(
        `${policyPath(siteId, environment)}/ingest-keys/${encodeURIComponent(keyId)}`,
        {
          method: "DELETE",
          headers: { "If-Match": ifMatch },
        },
      ),
    async getDefinitions(siteId) {
      try {
        return await request<DefinitionSetResponse>(
          `/v1/admin/sites/${encodeURIComponent(siteId)}/conversion-funnel-definitions`,
        );
      } catch (cause) {
        if (cause instanceof AnalyticsApiClientError && cause.status === 404) return null;

        throw cause;
      }
    },
    createDefinitions: (siteId, body) =>
      request<DefinitionSetResponse>(
        `/v1/admin/sites/${encodeURIComponent(siteId)}/conversion-funnel-definitions`,
        {
          method: "POST",
          headers: { "If-None-Match": "*" },
          body: JSON.stringify(body),
        },
      ),
    updateDefinitions: (siteId, body, ifMatch) =>
      request<DefinitionSetResponse>(
        `/v1/admin/sites/${encodeURIComponent(siteId)}/conversion-funnel-definitions`,
        {
          method: "PUT",
          headers: { "If-Match": ifMatch },
          body: JSON.stringify(body),
        },
      ),
  };

  function policyPath(siteId: string, environment: string): string {
    return `/v1/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-policy`;
  }
}

export async function loadSiteDirectory(): Promise<SiteDirectoryResult> {
  const token = process.env.DASHBOARD_CONFIG_ADMIN_TOKEN?.trim();
  if (!token) {
    return {
      kind: "unconfigured",
      message:
        "Site management is not configured. Set DASHBOARD_CONFIG_ADMIN_TOKEN on the Dashboard server.",
    };
  }
  try {
    const sites = await createSiteManagementClient({
      baseUrl: getSiteManagementApiUrl(),
      token,
    }).listSites();

    return { kind: "ready", sites };
  } catch (cause) {
    if (
      cause instanceof AnalyticsApiClientError &&
      (cause.status === 401 || cause.status === 403)
    ) {
      return { kind: "unauthorized", message: cause.message };
    }

    return {
      kind: "unavailable",
      message:
        cause instanceof AnalyticsApiClientError
          ? cause.message
          : "Site Management service is unavailable. Try again later.",
    };
  }
}

function validateSiteList(value: unknown): SiteListResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new AnalyticsApiClientError("Site Management returned an invalid Site list.", {
      kind: "response",
    });
  }
  if (value.next_cursor !== null && typeof value.next_cursor !== "string") {
    throw new AnalyticsApiClientError("Site Management returned an invalid page cursor.", {
      kind: "response",
    });
  }
  if (!value.items.every(isManagedSite)) {
    throw new AnalyticsApiClientError("Site Management returned an invalid Site entry.", {
      kind: "response",
    });
  }

  return value as unknown as SiteListResponse;
}

function isManagedSite(value: unknown): value is ManagedSite {
  if (!isRecord(value)) return false;

  return (
    typeof value.site_id === "string" &&
    (typeof value.display_name === "string" || value.display_name === null) &&
    (typeof value.website_url === "string" || value.website_url === null) &&
    (value.lifecycle_status === "active" || value.lifecycle_status === "archived") &&
    (value.setup_status === "ready" || value.setup_status === "needs_attention") &&
    Array.isArray(value.missing_requirements) &&
    typeof value.version === "number" &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readApiMessage(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error)) return undefined;

  return typeof value.error.message === "string" ? value.error.message : undefined;
}

function readApiCode(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error)) return undefined;

  return typeof value.error.code === "string" ? value.error.code : undefined;
}
