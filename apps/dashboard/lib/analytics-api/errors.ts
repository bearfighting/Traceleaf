export type AnalyticsApiErrorKind =
  "config" | "network" | "http" | "response" | "disabled" | "unavailable";

export interface AnalyticsApiClientErrorOptions {
  kind: AnalyticsApiErrorKind;
  status?: number;
  code?: string;
  cause?: unknown;
}

export class AnalyticsApiClientError extends Error {
  readonly kind: AnalyticsApiErrorKind;
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly cause: unknown;

  constructor(message: string, options: AnalyticsApiClientErrorOptions) {
    super(message);
    this.name = "AnalyticsApiClientError";
    this.kind = options.kind;
    this.status = options.status;
    this.code = options.code;
    this.cause = options.cause;
  }
}
