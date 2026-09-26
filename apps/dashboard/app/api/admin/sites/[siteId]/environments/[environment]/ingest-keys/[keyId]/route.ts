import { proxyConfigurationRequest } from "../../../../../../../../../lib/configuration-api/proxy";

type Context = { params: Promise<{ siteId: string; environment: string; keyId: string }> };

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { siteId, environment, keyId } = await context.params;
  const path = `/v1/admin/sites/${encodeURIComponent(siteId)}/environments/${encodeURIComponent(environment)}/ingest-keys/${encodeURIComponent(keyId)}`;

  return proxyConfigurationRequest(request, path, "DELETE", siteId);
}
