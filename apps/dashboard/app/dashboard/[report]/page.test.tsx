import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { generateMetadata } from "./page";

describe("Analytics report metadata", () => {
  it.each([
    ["pages", "Pages"],
    ["dimensions", "Dimensions"],
    ["custom-events", "Custom events"],
    ["web-vitals", "Web Vitals"],
  ])("uses the %s report title in document metadata", async (report, title) => {
    await expect(generateMetadata({ params: Promise.resolve({ report }) })).resolves.toEqual({
      title,
    });
  });

  it("uses a not found title for unknown report slugs", async () => {
    await expect(
      generateMetadata({ params: Promise.resolve({ report: "unknown-report" }) }),
    ).resolves.toEqual({ title: "Not Found" });
  });
});
