import { getSiteManagementApiUrl } from "../site-management/config";

const FORWARDED_HEADERS = ["if-match", "if-none-match"] as const;

export async function proxyConfigurationRequest(
  request: Request,
  upstreamPath: string,
  method: string,
  _siteId: string,
): Promise<Response> {
  if (method !== "GET" && method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (!origin || !isSameOrigin(request, origin)) {
      return Response.json(
        {
          error: {
            code: "cross_origin_request_rejected",
            message: "Configuration changes must come from this Dashboard origin.",
          },
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  const token = process.env.DASHBOARD_CONFIG_ADMIN_TOKEN;
  if (!token) {
    return Response.json(
      {
        error: {
          code: "dashboard_configuration_not_configured",
          message: "Configuration administration is not configured on the Dashboard server.",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const headers = new Headers({ Authorization: `Bearer ${token}`, Accept: "application/json" });
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const hasBody = method !== "GET" && method !== "HEAD";
    const upstream = await fetch(`${getSiteManagementApiUrl()}${upstreamPath}`, {
      method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
    });
    const responseHeaders = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    });
    const etag = upstream.headers.get("etag");
    if (etag) responseHeaders.set("ETag", etag);

    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "configuration_service_unavailable",
          message: "Configuration service is unavailable. Try again later.",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function isSameOrigin(request: Request, origin: string): boolean {
  try {
    const requestUrl = new URL(request.url);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || request.headers.get("host") || requestUrl.host;
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const protocol = forwardedProtocol || requestUrl.protocol.slice(0, -1);
    if (!/^https?$/.test(protocol)) return false;

    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}
