import { AnalyticsApiClientError } from "./errors";

export function getAnalyticsApiUrl(): string {
  const value = process.env.ANALYTICS_API_URL;

  if (!value) {
    throw new AnalyticsApiClientError("ANALYTICS_API_URL is required.", { kind: "config" });
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new AnalyticsApiClientError("ANALYTICS_API_URL must be an absolute HTTP(S) URL.", {
      kind: "config",
      cause,
    });
  }

  if (!/^https?:$/.test(url.protocol) || url.search || url.hash) {
    throw new AnalyticsApiClientError("ANALYTICS_API_URL must be an absolute HTTP(S) URL.", {
      kind: "config",
    });
  }

  return url.toString().replace(/\/+$/, "");
}
