export function validateQueryCases(document, errors) {
  if (!Array.isArray(document.cases) || document.cases.length === 0) {
    errors.push("Analytics API contract cases must be a non-empty array");
    return;
  }
  const ids = new Set();
  for (const testCase of document.cases) {
    if (!testCase?.id || ids.has(testCase.id))
      errors.push("Analytics API contract case IDs must be unique and non-empty");
    ids.add(testCase?.id);
    if (typeof testCase.path !== "string" || !testCase.path.includes("/reports/"))
      errors.push(`${testCase.id}: case path must be a reports path`);
    if (testCase.expected?.status !== 400)
      errors.push(`${testCase.id}: contract case must expect HTTP 400`);
    if (!testCase.expected?.error_code)
      errors.push(`${testCase.id}: expected.error_code is required`);
  }
  for (const code of [
    "invalid_date_range",
    "date_range_too_large",
    "invalid_limit",
    "invalid_event_name",
  ]) {
    if (!document.cases.some((testCase) => testCase.expected.error_code === code))
      errors.push(`missing API contract case for ${code}`);
  }
  for (const testCase of document.cases) validateQueryCaseSemantics(testCase, errors);
}

export function validateQueryCaseSemantics(testCase, errors) {
  const path = testCase.path.split("?")[0];
  const segments = path.split("/");
  const from = segments[5];
  const to = segments[6];
  const expectedCode = testCase.expected.error_code;
  if (expectedCode === "invalid_date_range" && isDate(from) && isDate(to) && from < to)
    errors.push(`${testCase.id}: invalid_date_range case must have invalid or reversed dates`);
  if (expectedCode === "date_range_too_large" && isDate(from) && isDate(to)) {
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
    if (days <= 366) errors.push(`${testCase.id}: date_range_too_large case must exceed 366 days`);
  }
  if (
    expectedCode === "invalid_limit" &&
    !/(?:^|&)limit=(?:0|101)(?:&|$)/.test(testCase.path.split("?")[1] ?? "")
  )
    errors.push(`${testCase.id}: invalid_limit case must use an out-of-range limit`);
}

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
