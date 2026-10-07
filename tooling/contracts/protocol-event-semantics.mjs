const prohibitedCustomEventKeys = new Set([
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

export function validateCustomEventProperties(properties) {
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
        if (prohibitedCustomEventKeys.has(key.toLowerCase().replace(/[_.-]/g, ""))) return false;
        if (!visit(item, depth + 1)) return false;
      }
      return true;
    }
    return false;
  };
  return visit(properties, 0) && Buffer.byteLength(JSON.stringify(properties), "utf8") <= 8192;
}

export function validateWebVital(event) {
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
