import { proxyConfigurationRequest } from "../../../../../../../../lib/settings/configuration-api/proxy";

type Context = { params: Promise<{ siteId: string; environment: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { siteId, environment } = await context.params;
  const path = `/v1/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-keys`;

  return proxyConfigurationRequest(request, path, "POST", siteId);
}
