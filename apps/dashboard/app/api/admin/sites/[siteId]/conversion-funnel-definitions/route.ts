import { proxyConfigurationRequest } from "../../../../../../lib/settings/configuration-api/proxy";

type Context = { params: Promise<{ siteId: string }> };

async function upstreamPath(context: Context): Promise<string> {
  const { siteId } = await context.params;

  return `/v1/admin/sites/${encodeURIComponent(siteId)}/conversion-funnel-definitions`;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { siteId } = await context.params;

  return proxyConfigurationRequest(request, await upstreamPath(context), "GET", siteId);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { siteId } = await context.params;

  return proxyConfigurationRequest(request, await upstreamPath(context), "POST", siteId);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { siteId } = await context.params;

  return proxyConfigurationRequest(request, await upstreamPath(context), "PUT", siteId);
}
