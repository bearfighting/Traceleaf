import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(
  fileURLToPath(new URL("../../packages/analytics-browser/", import.meta.url)),
);
const temporaryDirectory = mkdtempSync(join(tmpdir(), "traceleaf-browser-consumer-"));
const repositoryDirectory = resolve(packageDirectory, "../..");
const publishable = process.argv.includes("--publishable");

function readTarballFile(tarballPath, requestedPath) {
  const archive = gunzipSync(readFileSync(tarballPath));
  let offset = 0;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const path = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(
      header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim(),
      8,
    );
    const contentOffset = offset + 512;

    if (path === requestedPath) {
      return archive.subarray(contentOffset, contentOffset + size).toString("utf8");
    }

    offset = contentOffset + Math.ceil(size / 512) * 512;
  }

  throw new Error(`Tarball does not contain ${requestedPath}`);
}

try {
  execFileSync("pnpm", ["--filter", "@traceleaf/browser", "build"], {
    cwd: repositoryDirectory,
    stdio: "inherit",
  });

  const packResult = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--pack-destination", temporaryDirectory], {
      cwd: packageDirectory,
      encoding: "utf8",
    }),
  )[0];
  const tarball = join(temporaryDirectory, packResult.filename);
  const files = packResult.files.map(({ path }) => path);
  for (const requiredFile of [
    "package.json",
    "README.md",
    "LICENSE",
    "dist/index.js",
    "dist/index.d.ts",
  ]) {
    if (!files.includes(requiredFile)) throw new Error(`Tarball is missing ${requiredFile}`);
  }
  if (files.some((path) => /(^|\/)(src|.*\.test\.)/.test(path))) {
    throw new Error("Tarball contains source or test files");
  }

  const packedManifest = JSON.parse(readTarballFile(tarball, "package/package.json"));
  const runtimeDependencies = Object.keys(packedManifest.dependencies ?? {}).sort();
  if (JSON.stringify(runtimeDependencies) !== JSON.stringify(["ulid", "web-vitals"])) {
    throw new Error(`Unexpected runtime dependencies: ${runtimeDependencies.join(", ")}`);
  }
  if (publishable ? packedManifest.private === true : packedManifest.private !== true) {
    throw new Error(
      publishable
        ? "Publishable SDK tarball must not have private: true"
        : "SDK tarball must remain private outside a publishable release candidate",
    );
  }

  writeFileSync(
    join(temporaryDirectory, "package.json"),
    JSON.stringify(
      {
        name: "browser-sdk-consumer-check",
        private: true,
        type: "module",
        scripts: { build: "vite build", typecheck: "tsc --noEmit" },
        devDependencies: { typescript: "^6.0.3", vite: "^8.3.0" },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(temporaryDirectory, "index.html"),
    '<script type="module" src="/src/main.ts"></script>',
  );
  execFileSync("npm", ["install", "--no-audit", "--no-fund", tarball], {
    cwd: temporaryDirectory,
    stdio: "inherit",
  });
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import('@traceleaf/browser').then(({ createBrowserAnalytics }) => { if (typeof createBrowserAnalytics !== 'function') process.exit(1); })",
    ],
    {
      cwd: temporaryDirectory,
      stdio: "inherit",
    },
  );
  const sourceDirectory = join(temporaryDirectory, "src");
  mkdirSync(sourceDirectory, { recursive: true });
  writeFileSync(
    join(sourceDirectory, "main.ts"),
    `import { createBrowserAnalytics } from "@traceleaf/browser";
import type { Analytics, AnalyticsConsent, BrowserAnalyticsOptions } from "@traceleaf/browser";
const options: BrowserAnalyticsOptions = { siteId: "site_example", endpoint: "https://collector.example/v1/events", ingestKey: "public-key" };
const initialize: (options: BrowserAnalyticsOptions) => Analytics = createBrowserAnalytics;
const consent: AnalyticsConsent = "granted";
void initialize;
void consent;
void options;
`,
  );
  writeFileSync(
    join(temporaryDirectory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
      },
      include: ["src/main.ts"],
    }),
  );
  execFileSync("npm", ["run", "typecheck"], { cwd: temporaryDirectory, stdio: "inherit" });
  execFileSync("npm", ["run", "build"], { cwd: temporaryDirectory, stdio: "inherit" });
  process.stdout.write(`Tarball consumer acceptance passed: ${packResult.filename}\n`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
