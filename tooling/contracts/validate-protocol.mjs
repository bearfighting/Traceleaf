import { readFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateCustomEventProperties, validateWebVital } from "./protocol-event-semantics.mjs";
import { validateProtocolFixtures } from "./protocol-fixture-validation.mjs";

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

const failures =
  (await validateProtocolFixtures(resolve(fixtureRoot, "valid"), true, {
    readdirSync,
    resolve,
    readJson,
    validators,
    validateCustomEventProperties,
    validateWebVital,
  })) +
  (await validateProtocolFixtures(resolve(fixtureRoot, "invalid"), false, {
    readdirSync,
    resolve,
    readJson,
    validators,
    validateCustomEventProperties,
    validateWebVital,
  }));

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log("Protocol fixtures validated successfully.");
}
