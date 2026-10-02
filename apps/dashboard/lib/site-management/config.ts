import { getAnalyticsApiUrl } from "../analytics-api/config";
import { AnalyticsApiClientError } from "../analytics-api/errors";

export function getSiteManagementApiUrl(): string {
  const value = process.env.SITE_MANAGEMENT_API_URL?.trim();
  if (!value) return getAnalyticsApiUrl();

  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new AnalyticsApiClientError("SITE_MANAGEMENT_API_URL must be an absolute HTTP(S) URL.", {
      kind: "config",
      cause,
    });
  }

  if (!/^https?:$/.test(url.protocol) || url.search || url.hash) {
    throw new AnalyticsApiClientError("SITE_MANAGEMENT_API_URL must be an absolute HTTP(S) URL.", {
      kind: "config",
    });
  }

  return url.toString().replace(/\/+$/, "");
}
