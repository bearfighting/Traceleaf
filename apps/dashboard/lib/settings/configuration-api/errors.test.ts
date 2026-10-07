import { describe, expect, it } from "vitest";

import { apiErrorMessage, configurationRequestError } from "./errors";

describe("apiErrorMessage", () => {
  it("includes field paths and messages from validation details", () => {
    expect(
      apiErrorMessage({
        error: {
          message: "Configuration failed validation.",
          details: [
            {
              path: "/allowed_origins/0",
              code: "invalid_origin",
              message: "Origin must not include a path.",
            },
          ],
        },
      }),
    ).toBe("Configuration failed validation. /allowed_origins/0: Origin must not include a path.");
  });

  it("adds a reload hint for version conflicts", () => {
    expect(
      configurationRequestError(409, {
        error: { code: "configuration_version_conflict", message: "Configuration changed." },
      }),
    ).toBe("Configuration changed. Reload to review the latest configuration.");
  });

  it("does not add a reload hint to validation errors", () => {
    expect(
      configurationRequestError(422, {
        error: {
          code: "configuration_validation_failed",
          message: "Configuration failed validation.",
        },
      }),
    ).toBe("Configuration failed validation.");
  });

  it("falls back to the API message when no details exist", () => {
    expect(apiErrorMessage({ error: { message: "Configuration changed." } })).toBe(
      "Configuration changed.",
    );
  });
});
