import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const schema = JSON.parse(
  await readFile(path.join(root, "config/analytics-definitions.schema.json"), "utf8"),
);
const definitions = JSON.parse(
  await readFile(path.join(root, "config/analytics-definitions.json"), "utf8"),
);
const validate = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true }).compile(
  schema,
);

if (!validate(definitions)) {
  console.error(validate.errors);
  process.exitCode = 1;
} else {
  const whitespaceName = JSON.parse(JSON.stringify(definitions));
  whitespaceName.sites[0].conversions[0].name = "   ";
  if (validate(whitespaceName)) {
    console.error("Definition names containing only whitespace must be rejected.");
    process.exitCode = 1;
  } else {
    console.log("Analytics definitions match their schema.");
  }
}
