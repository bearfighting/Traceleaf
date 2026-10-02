import { proxyConfigurationRequest } from "../../../../lib/configuration-api/proxy";

export async function POST(request: Request): Promise<Response> {
  return proxyConfigurationRequest(request, "/v1/admin/sites", "POST", "");
}
