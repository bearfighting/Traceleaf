export function apiErrorMessage(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("error" in value)) return undefined;
  const error = value.error;
  if (typeof error !== "object" || error === null) return undefined;

  const message =
    "message" in error && typeof error.message === "string" ? error.message : undefined;
  const details = "details" in error && Array.isArray(error.details) ? error.details : [];
  const validationMessages = details.flatMap((detail: unknown) => {
    if (
      typeof detail !== "object" ||
      detail === null ||
      !("message" in detail) ||
      typeof detail.message !== "string"
    )
      return [];
    const path = "path" in detail && typeof detail.path === "string" ? detail.path : "";

    return [path ? path + ": " + detail.message : detail.message];
  });

  if (validationMessages.length) return [message, ...validationMessages].filter(Boolean).join(" ");

  return message;
}

export function configurationRequestError(status: number, value: unknown): string {
  const message = apiErrorMessage(value) ?? "Request failed (HTTP " + status + ").";

  return status === 409 ? message + " Reload to review the latest configuration." : message;
}
