import { proxyConfigurationRequest } from "../../../../../../../../lib/configuration-api/proxy";

type Context = { params: Promise<{ siteId: string; environment: string }> };

async function upstreamPath(context: Context): Promise<string> {
  const { siteId, environment } = await context.params;

  return `/v1/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-policy`;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { siteId } = await context.params;

  return proxyConfigurationRequest(request, await upstreamPath(context), "GET", siteId);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { siteId } = await context.params;

  return proxyConfigurationRequest(request, await upstreamPath(context), "PUT", siteId);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { siteId } = await context.params;

  return proxyConfigurationRequest(request, await upstreamPath(context), "POST", siteId);
}
