import { describe, expect, it } from "vitest";

import { normalizeAllowedOrigins, toEnvironmentPolicyPayload } from "./domain";

describe("environment policy domain", () => {
  it("trims origins and drops blank lines", () => {
    expect(normalizeAllowedOrigins("  https://one.test \n\n https://two.test\n  ")).toEqual([
      "https://one.test",
      "https://two.test",
    ]);
  });

  it("creates the API payload without changing field semantics", () => {
    expect(
      toEnvironmentPolicyPayload({
        enabled: false,
        originsText: "https://one.test\n \nhttps://two.test ",
        rateLimit: 450,
      }),
    ).toEqual({
      enabled: false,
      allowed_origins: ["https://one.test", "https://two.test"],
      rate_limit_per_minute: 450,
    });
  });
});
