import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (file) => JSON.parse(readFileSync(path.resolve(root, file), "utf8"));
const eventSchemaDirectory = path.resolve(root, "protocol/events/schemas");
const eventFixtureDirectory = path.resolve(root, "protocol/events/fixtures");
const policyDirectory = path.resolve(root, "protocol/contracts/configuration/current");

const eventSchemas = ["page-view-event", "custom-event", "web-vital-event", "event-batch"].map(
  (name) => readJson(`${eventSchemaDirectory}/${name}.schema.json`),
);
const eventAjv = new Ajv2020({ allErrors: true, strict: true });
addFormats(eventAjv);
for (const schema of eventSchemas.slice(0, 3)) eventAjv.addSchema(schema);
eventAjv.addSchema(readJson("protocol/contexts/browser-context.schema.json"));
const eventValidators = eventSchemas.slice(0, 3).map((schema) => eventAjv.getSchema(schema.$id));
const batchValidator = eventAjv.compile(eventSchemas[3]);

const policyAjv = new Ajv2020({ allErrors: true, strict: true });
addFormats(policyAjv);
const policyValidator = policyAjv.compile(
  readJson(`${policyDirectory}/environment-policy.schema.json`),
);

console.log("sample\texpected\tfixture\tschema_valid");
for (const expected of ["valid", "invalid"]) {
  for (const filename of readdirSync(`${eventFixtureDirectory}/${expected}`)
    .filter((name) => name.endsWith(".json"))
    .sort()) {
    const fixture = readJson(`${eventFixtureDirectory}/${expected}/${filename}`);
    const schemaValid = Object.hasOwn(fixture, "type")
      ? eventValidators.filter((validate) => validate(fixture)).length === 1
      : batchValidator(fixture);
    console.log(`event\t${expected}\t${filename}\t${schemaValid}`);
  }
  for (const filename of readdirSync(`${policyDirectory}/fixtures/environment-policy/${expected}`)
    .filter((name) => name.endsWith(".json"))
    .sort()) {
    const fixture = readJson(
      `${policyDirectory}/fixtures/environment-policy/${expected}/${filename}`,
    );
    console.log(`policy\t${expected}\t${filename}\t${policyValidator(fixture)}`);
  }
}
