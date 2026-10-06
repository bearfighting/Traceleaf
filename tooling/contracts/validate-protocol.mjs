import { readFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const protocolRoot = resolve(repositoryRoot, "protocol");
const schemaRoot = resolve(protocolRoot, "events/schemas");
const fixtureRoot = resolve(protocolRoot, "events/fixtures");

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const pageViewSchema = await readJson(resolve(schemaRoot, "page-view-event.schema.json"));
const customEventSchema = await readJson(resolve(schemaRoot, "custom-event.schema.json"));
const webVitalSchema = await readJson(resolve(schemaRoot, "web-vital-event.schema.json"));
const eventBatchSchema = await readJson(resolve(schemaRoot, "event-batch.schema.json"));
const contextSchema = await readJson(resolve(protocolRoot, "contexts/browser-context.schema.json"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

ajv.addSchema(pageViewSchema);
ajv.addSchema(customEventSchema);
ajv.addSchema(webVitalSchema);
ajv.addSchema(contextSchema);
const validators = {
  pageView: ajv.compile(pageViewSchema),
  customEvent: ajv.compile(customEventSchema),
  webVital: ajv.compile(webVitalSchema),
  batch: ajv.compile(eventBatchSchema),
};

async function validateFixtures(directory, expectedValid) {
  const filenames = readdirSync(directory)
    .filter((filename) => filename.endsWith(".json"))
    .sort();
  let failures = 0;

  for (const filename of filenames) {
    const path = resolve(directory, filename);
    const fixture = await readJson(path);
    const validator =
      filename.startsWith("event-batch") || filename === "oversized-batch.json"
        ? validators.batch
        : fixture.type === "custom_event"
          ? validators.customEvent
          : fixture.type === "web_vital"
            ? validators.webVital
            : validators.pageView;
    const schemaValid = validator(fixture);
    const actualValid =
      schemaValid &&
      (fixture.type !== "custom_event" || validateCustomEventProperties(fixture.properties)) &&
      (fixture.type !== "web_vital" || validateWebVital(fixture)) &&
      (!Array.isArray(fixture.events) ||
        fixture.events.every(
          (event) =>
            event.site_id === fixture.events[0]?.site_id &&
            (event.type !== "web_vital" || validateWebVital(event)),
        ));

    if (actualValid !== expectedValid) {
      console.error(`Protocol validation mismatch: ${path}`);
      console.error(validator.errors ?? "no validation details");
      failures += 1;
      continue;
    }

    console.log(`${expectedValid ? "PASS" : "EXPECTED FAIL"} ${path}`);
  }

  return failures;
}

const failures =
  (await validateFixtures(resolve(fixtureRoot, "valid"), true)) +
  (await validateFixtures(resolve(fixtureRoot, "invalid"), false));

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log("Protocol fixtures validated successfully.");
}

function validateCustomEventProperties(properties) {
  const prohibited = new Set([
    "email",
    "emailaddress",
    "useremail",
    "phone",
    "phonenumber",
    "name",
    "firstname",
    "lastname",
    "fullname",
    "address",
    "homeaddress",
    "streetaddress",
    "ip",
    "ipaddress",
    "useragent",
    "cookie",
    "password",
    "passwd",
    "token",
    "userid",
    "useridentifier",
  ]);
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return false;
  let keys = 0;
  const visit = (value, depth) => {
    if (value === null || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") return Buffer.byteLength(value, "utf8") <= 256;
    if (Array.isArray(value))
      return depth <= 4 && value.length <= 20 && value.every((item) => visit(item, depth + 1));
    if (typeof value === "object") {
      if (depth > 4) return false;
      for (const [key, item] of Object.entries(value)) {
        keys += 1;
        if (keys > 32 || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) return false;
        if (prohibited.has(key.toLowerCase().replace(/[_.-]/g, ""))) return false;
        if (!visit(item, depth + 1)) return false;
      }
      return true;
    }
    return false;
  };
  return visit(properties, 0) && Buffer.byteLength(JSON.stringify(properties), "utf8") <= 8192;
}

function validateWebVital(event) {
  const thresholds = {
    LCP: [2500, 4000, 600000],
    INP: [200, 500, 600000],
    CLS: [0.1, 0.25, 100],
    FCP: [1800, 3000, 600000],
    TTFB: [800, 1800, 600000],
  }[event.metric];
  if (
    !thresholds ||
    !Number.isFinite(event.value) ||
    event.value < 0 ||
    event.value > thresholds[2] ||
    event.page_view_occurred_at > event.occurred_at
  )
    return false;
  return (
    event.rating ===
    (event.value <= thresholds[0]
      ? "good"
      : event.value <= thresholds[1]
        ? "needs_improvement"
        : "poor")
  );
}
