import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAnalyticsApiClient } from "./client";
import { getAnalyticsApiUrl } from "./config";
import { AnalyticsApiClientError } from "./errors";

const baseUrl = "http://analytics-api:4002";

const canonicalApi = readCanonicalApi();
const overview = canonicalApi.overview.body;
const rangeOverview = canonicalApi.range_overview.body;
const timeline = canonicalApi.timeline.body;
const pages = canonicalApi.pages.body;
const visitorSession = {
  site_id: "site_playground",
  from: "2026-09-18",
  to: "2026-09-19",
  page_views: 3,
  unique_visitors: 2,
  sessions: 2,
  items: [
    { day: "2026-09-18", page_views: 2, unique_visitors: 1, sessions: 1 },
    { day: "2026-09-19", page_views: 1, unique_visitors: 1, sessions: 1 },
  ],
  data_as_of: "2026-09-19T12:00:00Z",
  freshness_status: "current",
  aggregation_version: 1,
};
const dimension = {
  site_id: "site_playground",
  from: "2026-09-18",
  to: "2026-09-19",
  dimension: "browser",
  items: [{ value: "unknown", page_views: 3, unique_visitors: 2, sessions: 2 }],
  data_as_of: "2026-09-19T12:00:00Z",
  freshness_status: "current",
  aggregation_version: 1,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function readCanonicalApi() {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../../../../../protocol/contracts/analytics-api/current/fixtures/single-page-view.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    expected: {
      api: {
        overview: { body: Record<string, unknown> };
        range_overview: { body: Record<string, unknown> };
        timeline: { body: Record<string, unknown> };
        pages: { body: Record<string, unknown> };
      };
    };
  };

  return fixture.expected.api;
}

function clientFor(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);

  return {
    client: createAnalyticsApiClient({ baseUrl, fetch: fetchMock }),
    fetchMock,
  };
}

async function expectHttpError(
  request: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await expect(request).rejects.toMatchObject({
    kind: "http",
    status,
    code,
    message: "fixture error",
  });
}

describe("Analytics API client configuration", () => {
  it.each([
    ["", "ANALYTICS_API_URL is required."],
    ["/analytics", "ANALYTICS_API_URL must be an absolute HTTP(S) URL."],
    ["ftp://analytics-api:4002", "ANALYTICS_API_URL must be an absolute HTTP(S) URL."],
    ["http://analytics-api:4002?debug=true", "ANALYTICS_API_URL must be an absolute HTTP(S) URL."],
  ])("rejects %s", (value, message) => {
    vi.stubEnv("ANALYTICS_API_URL", value);

    expect(() => getAnalyticsApiUrl()).toThrowError(
      expect.objectContaining({ kind: "config", message }),
    );
  });

  it("normalizes a valid configured URL", () => {
    vi.stubEnv("ANALYTICS_API_URL", "http://analytics-api:4002///");

    expect(getAnalyticsApiUrl()).toBe("http://analytics-api:4002");
  });

  it.each(["/analytics", "ftp://analytics-api:4002", "http://analytics-api:4002?debug=true"])(
    "rejects invalid client baseUrl %s",
    (value) => {
      expect(() => createAnalyticsApiClient({ baseUrl: value })).toThrowError(
        expect.objectContaining({ kind: "config" }),
      );
    },
  );
});

describe("Analytics API queries", () => {
  it("parses all four successful response shapes", async () => {
    const responses = [overview, rangeOverview, timeline, pages].map((body) => jsonResponse(body));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(responses[0] as Response)
      .mockResolvedValueOnce(responses[1] as Response)
      .mockResolvedValueOnce(responses[2] as Response)
      .mockResolvedValueOnce(responses[3] as Response);
    const client = createAnalyticsApiClient({ baseUrl, fetch: fetchMock });

    await expect(client.overview("site_playground")).resolves.toEqual(overview);
    await expect(
      client.rangeOverview("site_playground", "2026-09-01", "2026-09-18"),
    ).resolves.toEqual(rangeOverview);
    await expect(client.timeline("site_playground", "2026-09-01", "2026-09-18")).resolves.toEqual(
      timeline,
    );
    await expect(client.pages("site_playground", "2026-09-01", "2026-09-18")).resolves.toEqual(
      pages,
    );
  });

  it("builds encoded URLs and uses no-store GET requests", async () => {
    const { client, fetchMock } = clientFor(jsonResponse(overview));

    await client.overview("site/playground");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://analytics-api:4002/v1/sites/site%2Fplayground/overview",
      { method: "GET", cache: "no-store" },
    );
  });

  it("always includes report dates and defaults pages limit to 20", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(rangeOverview))
      .mockResolvedValueOnce(jsonResponse(timeline))
      .mockResolvedValueOnce(jsonResponse(pages));
    const client = createAnalyticsApiClient({ baseUrl, fetch: fetchMock });

    await client.rangeOverview("site_playground", "2026-09-01", "2026-09-18");
    await client.timeline("site_playground", "2026-09-01", "2026-09-18");
    await client.pages("site_playground", "2026-09-01", "2026-09-18");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://analytics-api:4002/v1/sites/site_playground/reports/2026-09-01/2026-09-18/overview",
      "http://analytics-api:4002/v1/sites/site_playground/reports/2026-09-01/2026-09-18/timeline",
      "http://analytics-api:4002/v1/sites/site_playground/reports/2026-09-01/2026-09-18/pages?limit=20",
    ]);
  });

  it("passes an explicit pages limit", async () => {
    const { client, fetchMock } = clientFor(jsonResponse(pages));

    await client.pages("site_playground", "2026-09-01", "2026-09-18", 100);

    expect(fetchMock.mock.calls[0]?.[0]).toContain("/pages?limit=100");
  });

  it("selects a historical definition version for conversion and funnel reports", async () => {
    const report = {
      site_id: "site_playground",
      from: "2026-09-18",
      to: "2026-09-19",
      total: 0,
      definition_version: "r2-abc",
      items: [],
      data_as_of: null,
      freshness_status: "current",
      aggregation_version: 1,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(report))
      .mockResolvedValueOnce(jsonResponse(report));
    const client = createAnalyticsApiClient({ baseUrl, fetch: fetchMock });
    await client.conversions?.(
      "site_playground",
      "2026-09-18",
      "2026-09-19",
      20,
      undefined,
      "r2-abc",
    );
    await client.funnels?.("site_playground", "2026-09-18", "2026-09-19", 20, undefined, "r2-abc");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${baseUrl}/v1/sites/site_playground/reports/2026-09-18/2026-09-19/conversions?limit=20&definition_version=r2-abc`,
      `${baseUrl}/v1/sites/site_playground/reports/2026-09-18/2026-09-19/funnels?limit=20&definition_version=r2-abc`,
    ]);
  });

  it("builds audience report URLs and validates freshness metadata", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(visitorSession))
      .mockResolvedValueOnce(jsonResponse(visitorSession))
      .mockResolvedValueOnce(jsonResponse(dimension));
    const client = createAnalyticsApiClient({ baseUrl, fetch: fetchMock });

    await expect(client.visitors("site_playground", "2026-09-18", "2026-09-19")).resolves.toEqual(
      visitorSession,
    );
    await expect(client.sessions("site_playground", "2026-09-18", "2026-09-19")).resolves.toEqual(
      visitorSession,
    );
    await expect(
      client.dimension("site_playground", "2026-09-18", "2026-09-19", "browser"),
    ).resolves.toEqual(dimension);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://analytics-api:4002/v1/sites/site_playground/reports/2026-09-18/2026-09-19/visitors",
      "http://analytics-api:4002/v1/sites/site_playground/reports/2026-09-18/2026-09-19/sessions",
      "http://analytics-api:4002/v1/sites/site_playground/reports/2026-09-18/2026-09-19/dimensions/browser?limit=20",
    ]);
  });
});

describe("Analytics API errors and response validation", () => {
  it.each([
    [400, "invalid_date_range"],
    [400, "date_range_too_large"],
  ])("maps reports API error %s", async (status, code) => {
    const { client } = clientFor(
      jsonResponse({ error: { code, message: "fixture error" } }, status),
    );

    await expectHttpError(
      client.rangeOverview("site_playground", "2026-09-01", "2026-09-18"),
      status,
      code,
    );
  });

  it("maps invalid limit from the pages endpoint", async () => {
    const { client } = clientFor(
      jsonResponse({ error: { code: "invalid_limit", message: "fixture error" } }, 400),
    );

    await expectHttpError(
      client.pages("site_playground", "2026-09-01", "2026-09-18", 0),
      400,
      "invalid_limit",
    );
  });

  it("maps an Analytics API error from the overview endpoint", async () => {
    const { client } = clientFor(
      jsonResponse({ error: { code: "analytics_api_error", message: "fixture error" } }, 500),
    );

    await expectHttpError(client.overview("site_playground"), 500, "analytics_api_error");
  });

  it("maps disabled audience report responses separately", async () => {
    const { client } = clientFor(
      jsonResponse({ error: { code: "analytics_not_enabled", message: "disabled" } }, 404),
    );

    await expect(
      client.visitors("site_playground", "2026-09-18", "2026-09-19"),
    ).rejects.toMatchObject({
      kind: "disabled",
      status: 404,
      code: "analytics_not_enabled",
    });
  });

  it("uses a fallback message for a non-JSON HTTP error", async () => {
    const { client } = clientFor(new Response("upstream failure", { status: 502 }));

    await expect(client.overview("site_playground")).rejects.toMatchObject({
      kind: "http",
      status: 502,
      message: "Analytics API failed to complete the request",
    });
  });

  it("maps network failures", async () => {
    const failure = new Error("connection refused");
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(failure);
    const client = createAnalyticsApiClient({ baseUrl, fetch: fetchMock });

    await expect(client.overview("site_playground")).rejects.toMatchObject({
      kind: "network",
      cause: failure,
    });
  });

  it("rejects invalid overview responses", async () => {
    const cases = [{}, { site_id: "site_playground", page_views: -1 }];

    for (const body of cases) {
      const { client } = clientFor(jsonResponse(body));

      await expect(client.overview("site_playground")).rejects.toBeInstanceOf(
        AnalyticsApiClientError,
      );
    }
  });

  it("rejects invalid range, timeline, and pages responses", async () => {
    const { client: rangeClient } = clientFor(
      jsonResponse({
        site_id: "site_playground",
        from: "2026-02-30",
        to: "2026-09-18",
        page_views: 1,
      }),
    );
    const { client: timelineClient } = clientFor(
      jsonResponse({
        site_id: "site_playground",
        from: "2026-09-01",
        to: "2026-09-18",
        items: [{ day: "2026-02-30", page_views: 1 }],
      }),
    );
    const { client: pagesClient } = clientFor(
      jsonResponse({
        site_id: "site_playground",
        from: "2026-09-01",
        to: "2026-09-18",
        items: [{ path: "about", page_views: 1 }],
      }),
    );

    await expect(
      rangeClient.rangeOverview("site_playground", "2026-09-01", "2026-09-18"),
    ).rejects.toBeInstanceOf(AnalyticsApiClientError);
    await expect(
      timelineClient.timeline("site_playground", "2026-09-01", "2026-09-18"),
    ).rejects.toBeInstanceOf(AnalyticsApiClientError);
    await expect(
      pagesClient.pages("site_playground", "2026-09-01", "2026-09-18"),
    ).rejects.toBeInstanceOf(AnalyticsApiClientError);
  });

  it("rejects non-UTC response timestamps", async () => {
    const { client } = clientFor(
      jsonResponse({ ...visitorSession, data_as_of: "2026-09-19 12:00:00" }),
    );

    await expect(
      client.visitors("site_playground", "2026-09-18", "2026-09-19"),
    ).rejects.toBeInstanceOf(AnalyticsApiClientError);
  });

  it("rejects audience report responses for a different request scope", async () => {
    const { client } = clientFor(
      jsonResponse({ ...visitorSession, site_id: "another-site", dimension: undefined }),
    );

    await expect(
      client.visitors("site_playground", "2026-09-18", "2026-09-19"),
    ).rejects.toBeInstanceOf(AnalyticsApiClientError);
  });

  it("rejects a dimension response for a different dimension", async () => {
    const { client } = clientFor(jsonResponse({ ...dimension, dimension: "language" }));

    await expect(
      client.dimension("site_playground", "2026-09-18", "2026-09-19", "browser"),
    ).rejects.toBeInstanceOf(AnalyticsApiClientError);
  });

  it("requests and validates conversion and funnel reports", async () => {
    const conversionResponse = {
      site_id: "site_playground",
      from: "2026-09-18",
      to: "2026-09-18",
      total: 1,
      definition_version: "v1",
      items: [
        {
          definition_id: "purchase",
          day: "2026-09-18",
          event_count: 1,
          converted_sessions: 1,
          eligible_sessions: 2,
          conversion_rate: 0.5,
        },
      ],
      data_as_of: null,
      freshness_status: "current",
      aggregation_version: 1,
    };
    const funnelResponse = {
      site_id: "site_playground",
      from: "2026-09-18",
      to: "2026-09-18",
      total: 1,
      definition_version: "v1",
      items: [
        {
          definition_id: "checkout",
          day: "2026-09-18",
          step_index: 0,
          sessions: 2,
          conversion_rate: 1,
        },
      ],
      data_as_of: null,
      freshness_status: "current",
      aggregation_version: 1,
    };
    const conversion = clientFor(jsonResponse(conversionResponse));
    await expect(
      conversion.client.conversions?.(
        "site_playground",
        "2026-09-18",
        "2026-09-18",
        10,
        "purchase",
      ),
    ).resolves.toEqual(conversionResponse);
    expect(conversion.fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/conversions?limit=10&definition_id=purchase"),
      expect.any(Object),
    );
    const funnel = clientFor(jsonResponse(funnelResponse));
    await expect(
      funnel.client.funnels?.("site_playground", "2026-09-18", "2026-09-18"),
    ).resolves.toEqual(funnelResponse);
    const invalid = clientFor(
      jsonResponse({
        ...funnelResponse,
        items: [
          { ...funnelResponse.items[0], visitor_id: "must-not-be-exposed", conversion_rate: 2 },
        ],
      }),
    );
    await expect(
      invalid.client.funnels?.("site_playground", "2026-09-18", "2026-09-18"),
    ).rejects.toBeInstanceOf(AnalyticsApiClientError);
  });

  it("maps a successful non-JSON response to a response error", async () => {
    const { client } = clientFor(new Response("not json"));

    await expect(client.overview("site_playground")).rejects.toMatchObject({
      kind: "response",
      message: "Analytics API returned an invalid response",
    });
  });
});

it("requests and validates Geo country reports including unknown", async () => {
  const result = {
    site_id: "site_playground",
    from: "2026-09-18",
    to: "2026-09-19",
    coverage_from: "2026-09-18",
    providers: ["maxmind"],
    data_as_of: "2026-09-19T12:00:00Z",
    freshness_status: "current",
    aggregation_version: 1,
    items: [
      { country_code: "CA", page_views: 3 },
      { country_code: "unknown", page_views: 1 },
    ],
  };
  const { client, fetchMock } = clientFor(jsonResponse(result));
  await expect(client.geoCountries("site_playground", "2026-09-18", "2026-09-19")).resolves.toEqual(
    result,
  );
  expect(fetchMock).toHaveBeenCalledWith(
    `${baseUrl}/v1/sites/site_playground/reports/2026-09-18/2026-09-19/geo`,
    { method: "GET", cache: "no-store" },
  );

  const invalid = clientFor(
    jsonResponse({ ...result, items: [{ country_code: "USA", page_views: 3 }] }),
  );
  await expect(
    invalid.client.geoCountries("site_playground", "2026-09-18", "2026-09-19"),
  ).rejects.toBeInstanceOf(AnalyticsApiClientError);

  const unsupportedProvider = clientFor(jsonResponse({ ...result, providers: ["other"] }));
  await expect(
    unsupportedProvider.client.geoCountries("site_playground", "2026-09-18", "2026-09-19"),
  ).rejects.toBeInstanceOf(AnalyticsApiClientError);
});
