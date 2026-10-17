import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  anchors,
  commandSignatures,
  headings,
  links,
  markdownLinkProblems,
  readmePairProblems,
  stripCode,
} from "./check-docs.mjs";

test("ignores links and headings inside fenced and inline code", () => {
  const markdown =
    "# Visible\n\n`[inline](missing.md)` ``[multi](missing-too.md)``\n\n   ```md\n   ## Hidden\n   [hidden](missing.md)\n   ````\n\n[valid](guide.md)";
  assert.deepEqual(headings(markdown), [1]);
  assert.deepEqual(links(markdown), ["guide.md"]);
  assert.equal(stripCode(markdown).includes("Hidden"), false);
  assert.deepEqual(
    commandSignatures("   ```sh\n   pnpm test\n   ````"),
    ["pnpm test"],
  );
  assert.equal(anchors("## Inline ``code `ticks` title``").has("inline-code-ticks-title"), true);
});

test("resolves Unicode heading slugs and explicit HTML ids", () => {
  const known = anchors(
    '# 页面浏览（指南）\n\n### 日志策略、缓冲与批次限制验收（2026-10-11）\n\n<a id="custom-anchor"></a>',
  );
  assert.equal(known.has("页面浏览指南"), true);
  assert.equal(anchors("## Inline `code` title").has("inline-code-title"), true);
  assert.equal(known.has("日志策略缓冲与批次限制验收2026-10-11"), true);
  assert.equal(known.has("日志策略-缓冲与批次限制验收-2026-10-11"), false);
  assert.equal(known.has("custom-anchor"), true);
});

test("extracts local links while retaining external URLs for the caller to skip", () => {
  assert.deepEqual(links("[local](../guide.md) [web](https://example.com) <./image.svg>"), [
    "../guide.md",
    "https://example.com",
    "./image.svg",
  ]);
});

test("extracts reference-style and raw HTML links", () => {
  assert.deepEqual(
    links('[Guide][guide]\n\n[guide]: ../guide.md\n\n<a href="../index.md">Index</a>'),
    ["../guide.md", "../index.md"],
  );
});

test("validates local targets and heading anchors while ignoring code and external links", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "traceleaf-doc-links-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source.md");
  fs.writeFileSync(
    path.join(root, "target.md"),
    '# 页面标题（帮助）\n\n<div id="custom-id"></div>\n',
  );
  const problems = markdownLinkProblems(
    source,
    "[valid](target.md#页面标题帮助) [html](target.md#custom-id) [broken](missing.md) [web](https://example.com)\n\n```md\n[ignored](missing-in-code.md)\n```",
    root,
  );
  assert.deepEqual(problems, ["missing local link target missing.md"]);
});

test("compares command arguments and filtered workspace commands", () => {
  const first = commandSignatures(
    "`pnpm --filter @traceleaf/browser build`\n```sh\nnode tooling/docs/check-docs.mjs\n```",
  );
  const changed = commandSignatures(
    "`pnpm --filter @traceleaf/browser test`\n```sh\nnode tooling/docs/other-check.mjs\n```",
  );
  assert.deepEqual(first, [
    "node tooling/docs/check-docs.mjs",
    "pnpm --filter @traceleaf/browser build",
  ]);
  assert.notDeepEqual(first, changed);
  assert.notDeepEqual(
    commandSignatures("```sh\ncd packages/a\nnpm pack\n```"),
    commandSignatures("```sh\ncd packages/b\nnpm pack\n```"),
  );
  assert.deepEqual(
    commandSignatures('```sh\n: "${DATABASE_URL:?provide the reviewed target}"\n```'),
    commandSignatures('```sh\n: "${DATABASE_URL:?提供已审核目标}"\n```'),
  );
  assert.notDeepEqual(
    commandSignatures('```sh\n: "${DATABASE_URL:?provide the reviewed target}"\n```'),
    commandSignatures("```sh\nnode tooling/import.mjs\n```"),
  );
  assert.notDeepEqual(
    commandSignatures('```sh\npg_dump --format=custom --file="$BACKUP_FILE"\n```'),
    commandSignatures('```sh\npg_restore --list "$BACKUP_FILE"\n```'),
  );
  assert.deepEqual(commandSignatures("```ts\nexport type Event = string\n```"), []);
  assert.deepEqual(
    commandSignatures("```sh\nexport DATABASE_URL=postgres://localhost/test\n```"),
    ["export DATABASE_URL=postgres://localhost/test"],
  );
  assert.notDeepEqual(
    commandSignatures("```sh\npnpm db:migrate\npnpm test\n```"),
    commandSignatures("```sh\npnpm test\npnpm db:migrate\n```"),
  );
  assert.notDeepEqual(
    commandSignatures("```sh\npnpm test\npnpm test\n```"),
    commandSignatures("```sh\npnpm test\n```"),
  );
  assert.deepEqual(commandSignatures("Use ``pnpm test`` to run checks."), ["pnpm test"]);
  assert.notDeepEqual(
    commandSignatures("`pnpm --filter @traceleaf/browser build`"),
    commandSignatures("`pnpm --recursive --filter @traceleaf/browser build`"),
  );
  assert.notDeepEqual(commandSignatures("`build --mode=development`"), commandSignatures("`build --mode=production`"));
  assert.notDeepEqual(
    commandSignatures('```sh\npnpm run report --label "batch # one"\n```'),
    commandSignatures('```sh\npnpm run report --label "batch # two"\n```'),
  );
  assert.deepEqual(
    commandSignatures("```sh\npnpm test # translated comment\n```"),
    commandSignatures("```sh\npnpm test # 已翻译的注释\n```"),
  );
});

test("validates paired README links, section structure, required project links, and commands", () => {
  const root = "/repo";
  const englishPath = "/repo/packages/example/README.md";
  const chinesePath = "/repo/packages/example/README.zh-CN.md";
  const english =
    "# Example\n\n[简体中文](./README.zh-CN.md) [Project](../../README.md)\n\n```sh\npnpm build\n```";
  const chinese =
    "# Example\n\n[English](README.md) [项目](../../README.zh-CN.md)\n\n```sh\npnpm build\n```";
  assert.deepEqual(readmePairProblems(englishPath, chinesePath, english, chinese, root), []);

  const problems = readmePairProblems(
    englishPath,
    chinesePath,
    english.replace("README.zh-CN.md", "missing.md").replace("pnpm build", "pnpm test"),
    chinese.replace("# Example", "## Example").replace("../../README.zh-CN.md", "guide.md"),
    root,
  );
  assert.equal(
    problems.some((problem) => problem.includes("must link")),
    true,
  );
  assert.equal(
    problems.some((problem) => problem.includes("heading structure")),
    true,
  );
  assert.equal(
    problems.some((problem) => problem.includes("required project overview/status")),
    true,
  );
  assert.equal(
    problems.some((problem) => problem.includes("commands differ")),
    true,
  );
});
