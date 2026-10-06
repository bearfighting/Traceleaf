export const ROUTER_TARGETS = Object.freeze({
  next: Object.freeze({
    packageName: "@web-analytics/nextjs-router-playground",
    profile: "playground-next",
    port: 3000,
  }),
  react: Object.freeze({
    packageName: "@web-analytics/react-router-playground",
    profile: "playground-react",
    port: 3101,
  }),
  tanstack: Object.freeze({
    packageName: "@web-analytics/tanstack-router-playground",
    profile: "playground-tanstack",
    port: 3102,
  }),
});

export const ROUTER_USAGE = `Usage:
  pnpm dev [--router next|react|tanstack] [dev options]
  pnpm docker:dev [--router next|react|tanstack] [--with-backend [--seed-init|--seed]]`;

export function parseDevArgs(args) {
  const { router, passthrough } = parseRouter(args, { allowBackend: false });
  return { router, target: ROUTER_TARGETS[router], passthrough };
}

export function parseDockerArgs(args) {
  const { router, withBackend, seedInit, passthrough } = parseRouter(args, { allowBackend: true });
  if (passthrough.length > 0) {
    throw new RouterArgumentError(`Unknown docker:dev argument '${passthrough[0]}'`);
  }
  if (seedInit && !withBackend) {
    throw new RouterArgumentError("--seed-init requires --with-backend");
  }
  return { router, target: ROUTER_TARGETS[router], withBackend, seedInit };
}

function parseRouter(args, { allowBackend }) {
  let router = "next";
  let routerSpecified = false;
  let withBackend = false;
  let seedInit = false;
  const passthrough = [];
  let forward = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (forward) {
      passthrough.push(argument);
      continue;
    }
    if (argument === "--") {
      forward = true;
      continue;
    }
    if (argument === "--with-backend") {
      if (!allowBackend) {
        throw new RouterArgumentError("--with-backend is only supported by docker:dev");
      }
      if (withBackend) throw new RouterArgumentError("--with-backend may only be specified once");
      withBackend = true;
      continue;
    }
    if (argument === "--seed-init" || argument === "--seed") {
      if (!allowBackend) {
        throw new RouterArgumentError(`${argument} is only supported by docker:dev --with-backend`);
      }
      if (seedInit) throw new RouterArgumentError("--seed-init/--seed may only be specified once");
      seedInit = true;
      continue;
    }

    let value;
    if (argument === "--router") {
      value = args[++index];
      if (!value || value.startsWith("--")) {
        throw new RouterArgumentError("--router requires next, react, or tanstack");
      }
    } else if (argument.startsWith("--router=")) {
      value = argument.slice("--router=".length);
    } else {
      passthrough.push(argument);
      continue;
    }

    if (routerSpecified) throw new RouterArgumentError("--router may only be specified once");
    if (!Object.hasOwn(ROUTER_TARGETS, value)) {
      throw new RouterArgumentError(`Unknown router '${value}'`);
    }
    router = value;
    routerSpecified = true;
  }

  return { router, withBackend, seedInit, passthrough };
}

export class RouterArgumentError extends Error {
  constructor(message) {
    super(`${message}\n\n${ROUTER_USAGE}`);
    this.name = "RouterArgumentError";
  }
}
