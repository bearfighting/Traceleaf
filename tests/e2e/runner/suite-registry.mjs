export const suiteRegistry = Object.freeze({
  analytics: {
    script: "e2e-analytics.mjs",
    services: ["collector", "analytics-api"],
    reset: "full",
    shared: true,
  },
  configuration: {
    script: "e2e-configuration.mjs",
    services: ["collector", "processor", "analytics-api", "dashboard"],
    reset: "full",
    shared: true,
  },
  "site-management": {
    script: "e2e-site-management.mjs",
    services: ["collector", "processor", "analytics-api"],
    reset: "full",
    shared: true,
  },
  "dev-startup": { script: "e2e-dev-startup.mjs", services: [], reset: null, shared: false },
  "site-onboarding": {
    script: "e2e-site-onboarding.mjs",
    services: ["dashboard", "playground-next"],
    reset: null,
    shared: false,
  },
  dashboard: {
    script: "e2e-dashboard.mjs",
    services: ["collector", "analytics-api", "dashboard", "playground-next"],
    reset: "full",
    shared: true,
  },
  "router-adapters": {
    script: "e2e-router-adapters.mjs",
    services: [],
    reset: null,
    shared: false,
  },
  "router-compose": {
    script: "e2e-router-compose.mjs",
    services: ["playground-react"],
    reset: null,
    shared: false,
  },
});

const groups = Object.freeze({
  api: ["analytics", "configuration", "site-management"],
  router: ["router-adapters", "router-compose"],
  onboarding: ["site-onboarding"],
});

export function parseE2EArguments(args) {
  const suites = [];
  let all = false;
  let keepEnvironment = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--all") all = true;
    else if (argument === "--keep-environment") keepEnvironment = true;
    else if (argument === "--suite") {
      const selection = args[++index];
      if (!selection || selection.startsWith("--")) throw new Error("--suite requires an ID.");
      for (const id of selection.split(",")) {
        const expanded = groups[id] ?? [id];
        for (const suite of expanded) {
          if (!suiteRegistry[suite]) throw new Error(`Unknown E2E suite '${id}'.`);
          if (!suites.includes(suite)) suites.push(suite);
        }
      }
    } else throw new Error(`Unknown E2E option '${argument}'.`);
  }
  if (all && suites.length) throw new Error("--all cannot be combined with --suite.");
  if (!all && suites.length === 0) throw new Error("Select suites with --suite <id> or --all.");
  return { suites: all ? Object.keys(suiteRegistry) : suites, keepEnvironment };
}
