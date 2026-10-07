export async function validateProtocolFixtures(
  directory,
  expectedValid,
  { readdirSync, resolve, readJson, validators, validateCustomEventProperties, validateWebVital },
) {
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
