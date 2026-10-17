import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pairManifest = JSON.parse(
  fs.readFileSync(path.join(root, "tooling/docs/readme-pairs.json"), "utf8"),
);
const errors = [];
const fail = (file, message) => errors.push(`${path.relative(root, file)}: ${message}`);

function markdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "archive" || entry.name === "fixtures" || entry.name === "generated")
      return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.isFile() && entry.name.endsWith(".md") ? [full] : [];
  });
}
export function stripCode(markdown) {
  return stripInlineCode(stripFencedCode(markdown));
}
function stripFencedCode(markdown) {
  return parseFencedCode(markdown).text;
}
function parseFencedCode(markdown) {
  const lines = markdown.split(/\r?\n/);
  const visibleLines = [...lines];
  const blocks = [];
  let fence = null;
  let content = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      const closing = new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`);
      visibleLines[index] = "";
      if (closing.test(line)) {
        blocks.push({ content: content.join("\n"), info: fence.info });
        content = [];
        fence = null;
      } else content.push(line.replace(/^ {0,3}/, ""));
      continue;
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!opening || (opening[1][0] === "`" && opening[2].includes("`"))) continue;
    fence = {
      character: opening[1][0],
      length: opening[1].length,
      info: opening[2].trim().split(/\s+/, 1)[0].toLowerCase(),
    };
    content = [];
    visibleLines[index] = "";
  }
  if (fence) blocks.push({ content: content.join("\n"), info: fence.info });
  return { text: visibleLines.join("\n"), blocks };
}
function stripInlineCode(markdown, preserveContent = false) {
  let result = "";
  let cursor = 0;
  for (const span of inlineCodeSpans(markdown)) {
    result += markdown.slice(cursor, span.start);
    const content = span.content;
    result += preserveContent ? content : content.replace(/[^\n]/g, " ");
    cursor = span.end;
  }
  return result + markdown.slice(cursor);
}
function inlineCodeSpans(markdown) {
  const spans = [];
  let index = 0;
  while (index < markdown.length) {
    if (markdown[index] !== "`") {
      index += 1;
      continue;
    }
    let openingEnd = index + 1;
    while (markdown[openingEnd] === "`") openingEnd += 1;
    let precedingSlashes = 0;
    for (let cursor = index - 1; cursor >= 0 && markdown[cursor] === "\\"; cursor -= 1)
      precedingSlashes += 1;
    if (precedingSlashes % 2 === 1) {
      index = openingEnd;
      continue;
    }
    const delimiterLength = openingEnd - index;
    let closeStart = -1;
    let search = openingEnd;
    while (search < markdown.length) {
      const candidate = markdown.indexOf("`", search);
      if (candidate < 0) break;
      let candidateEnd = candidate + 1;
      while (markdown[candidateEnd] === "`") candidateEnd += 1;
      let escapedSlashes = 0;
      for (let cursor = candidate - 1; cursor >= 0 && markdown[cursor] === "\\"; cursor -= 1)
        escapedSlashes += 1;
      if (candidateEnd - candidate === delimiterLength && escapedSlashes % 2 === 0) {
        closeStart = candidate;
        break;
      }
      search = candidateEnd;
    }
    if (closeStart < 0) {
      index = openingEnd;
      continue;
    }
    const end = closeStart + delimiterLength;
    spans.push({ start: index, end, content: markdown.slice(openingEnd, closeStart) });
    index = end;
  }
  return spans;
}
export function slug(heading) {
  return heading
    .replace(/<[^>]*>/g, "")
    .toLowerCase()
    .trim()
    .replace(/[`*_~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[，,、]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
export function anchors(markdown) {
  const headingSource = stripInlineCode(stripFencedCode(markdown), true);
  const idSource = stripCode(markdown);
  const result = new Set();
  const counts = new Map();
  for (const match of headingSource.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slug(match[1]);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    result.add(count ? `${base}-${count}` : base);
  }
  for (const match of idSource.matchAll(/\bid=["']([^"']+)["']/g)) result.add(match[1]);
  return result;
}
export function links(markdown) {
  const source = stripCode(markdown);
  const found = [];
  const references = new Map(
    [...source.matchAll(/^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?/gm)].map((match) => [
      match[1].trim().toLowerCase(),
      match[2],
    ]),
  );
  const body = source.replace(/^ {0,3}\[[^\]]+\]:\s*<?[^\s>]+>?[^\n]*$/gm, "");
  for (const match of body.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^\s)]*)(?:\s+[^)]*)?\)/g))
    found.push(match[1].replace(/^<|>$/g, ""));
  for (const match of body.matchAll(/<((?:\.\.\/|\.\/|\/)[^ >]+)>/g))
    if (!/^\/[a-z][\w-]*$/i.test(match[1])) found.push(match[1]);
  for (const match of body.matchAll(/!?\[([^\]]+)\](?:\[([^\]]*)\])?/g)) {
    const label = (match[2] || match[1]).trim().toLowerCase();
    if (references.has(label)) found.push(references.get(label));
  }
  for (const match of body.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) found.push(match[1]);
  return found;
}
export function markdownLinkProblems(file, markdown, repositoryRoot = root) {
  const problems = [];
  for (const href of links(markdown)) {
    if (href === "#") continue;
    if (!href || href.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("#")) {
      if (href.startsWith("#") && !anchors(markdown).has(decodeURIComponent(href.slice(1))))
        problems.push(`missing anchor ${href}`);
      continue;
    }
    const [rawPath, rawAnchor] = href.split("#", 2);
    const target = path.resolve(path.dirname(file), decodeURIComponent(rawPath.split("?")[0]));
    if (!target.startsWith(repositoryRoot + path.sep) && target !== repositoryRoot) {
      problems.push(`link escapes repository: ${href}`);
      continue;
    }
    if (!fs.existsSync(target)) {
      problems.push(`missing local link target ${href}`);
      continue;
    }
    if (rawAnchor && target.endsWith(".md")) {
      const targetText = fs.readFileSync(target, "utf8");
      if (!anchors(targetText).has(decodeURIComponent(rawAnchor)))
        problems.push(`missing anchor in ${href}`);
    }
  }
  return problems;
}
function checkLinks(file, markdown) {
  for (const problem of markdownLinkProblems(file, markdown)) fail(file, problem);
}
export function headings(markdown) {
  return [...stripCode(markdown).matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)].map((m) => m[1].length);
}
function commandLines(markdown) {
  return parseFencedCode(markdown).blocks
    .filter(({ info }) => ["sh", "shell", "bash", "zsh", "console", "shellsession", "terminal"].includes(info))
    .flatMap(({ content }) => {
      const logicalLines = [];
      for (const rawLine of content.split("\n")) {
        const line = rawLine.trim();
        if (logicalLines.length && logicalLines.at(-1).endsWith("\\"))
          logicalLines[logicalLines.length - 1] = `${logicalLines.at(-1).slice(0, -1)} ${line}`;
        else logicalLines.push(line);
      }
      return logicalLines
        .filter((line) =>
          /^(?:\$\s*)?(?::\s+"\$\{[A-Za-z_][A-Za-z\d_]*:\?[^}]*\}"|export\s+[A-Za-z_][A-Za-z\d_]*=|(pnpm|npm|npx|node|cargo|docker|git|make|bash|curl|psql|pg_dump|pg_restore|cd|set|umask|source|mkdir|install|chmod|rm|cp|mv|touch|printf|echo)\b)/.test(
            line,
          ),
        )
        .map((line) =>
          line
            .replace(/^\$\s*/, "")
            .replace(/(\$\{[A-Za-z_][A-Za-z\d_]*:\?)[^}]*(\})/, "$1$2")
            .trim(),
        );
    });
}
function inlineCommands(markdown) {
  return inlineCodeSpans(stripFencedCode(markdown))
    .map(({ content }) => content)
    .filter((s) =>
      /^(?::\s+"\$\{[A-Za-z_][A-Za-z\d_]*:\?[^}]*\}"|export\s+[A-Za-z_][A-Za-z\d_]*=|(pnpm|npm|npx|node|cargo|docker|git|make|bash|curl|psql|pg_dump|pg_restore|cd|set|umask|source|mkdir|install|chmod|rm|cp|mv|touch|printf|echo|build|typecheck|test|check|validate)\b)/.test(
        s,
      ),
    )
    .map(commandSignature);
}
function stripShellComment(command) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "#" && (index === 0 || /\s/.test(command[index - 1])))
      return command.slice(0, index).trimEnd();
  }
  return command;
}
function commandSignature(command) {
  const normalized = command
    .replace(/^\$\s*/, "")
    .replace(/(\$\{[A-Za-z_][A-Za-z\d_]*:\?)[^}]*(\})/, "$1$2")
    .trim();
  const uncommented = stripShellComment(normalized);
  const tokens = uncommented.split(/\s+/);
  if (["build", "typecheck", "test", "check", "validate"].includes(tokens[0]))
    return `pnpm ${tokens.join(" ")}`;
  return uncommented.replace(/\s+/g, " ");
}
export function commandSignatures(markdown) {
  return [...commandLines(markdown), ...inlineCommands(markdown)].map(commandSignature);
}
export function readmePairProblems(englishFile, chineseFile, en, zh, projectRoot) {
  const problems = [];
  const linksToFile = (text, fromFile, toFile) =>
    links(text).some(
      (href) =>
        path.resolve(path.dirname(fromFile), href.split(/[?#]/, 1)[0]) === path.resolve(toFile),
    );
  if (!linksToFile(en, englishFile, chineseFile))
    problems.push(`English README must link to ${path.basename(chineseFile)}`);
  if (!linksToFile(zh, chineseFile, englishFile))
    problems.push(`Chinese README must link to ${path.basename(englishFile)}`);
  if (JSON.stringify(headings(en)) !== JSON.stringify(headings(zh)))
    problems.push("heading structure differs between README editions");
  for (const [file, text] of [
    [englishFile, en],
    [chineseFile, zh],
  ]) {
    const foundTargets = links(text).map((href) =>
      path.resolve(path.dirname(file), href.split("#")[0]),
    );
    if (path.dirname(file) === projectRoot) {
      for (const target of ["docs/mvp-scope.md", "docs/project-status.md"])
        if (!foundTargets.includes(path.resolve(projectRoot, target)))
          problems.push(`required project overview/status link missing: ${target}`);
    } else if (
      !foundTargets.includes(path.resolve(projectRoot, "README.md")) &&
      !foundTargets.includes(path.resolve(projectRoot, "README.zh-CN.md")) &&
      !foundTargets.includes(path.resolve(projectRoot, "docs/project-status.md"))
    ) {
      problems.push("required project overview/status link missing");
    }
  }
  if (JSON.stringify(commandSignatures(en)) !== JSON.stringify(commandSignatures(zh)))
    problems.push("commands differ between README editions");
  return problems;
}
function checkPair(englishPath, chinesePath) {
  const englishFile = path.join(root, englishPath);
  const chineseFile = path.join(root, chinesePath);
  for (const file of [englishFile, chineseFile])
    if (!fs.existsSync(file)) fail(file, "required bilingual README is missing");
  if (!fs.existsSync(englishFile) || !fs.existsSync(chineseFile)) return;
  const problems = readmePairProblems(
    englishFile,
    chineseFile,
    fs.readFileSync(englishFile, "utf8"),
    fs.readFileSync(chineseFile, "utf8"),
    root,
  );
  for (const problem of problems) fail(englishFile, problem);
}

export function validateDocumentation() {
  errors.length = 0;
  const files = [
    ...new Set([
      ...markdownFiles(path.join(root, "docs")),
      ...markdownFiles(path.join(root, "protocol")),
      ...pairManifest.flat(),
    ]),
  ].map((file) => (path.isAbsolute(file) ? file : path.join(root, file)));
  for (const file of files) {
    if (
      !fs.existsSync(file) ||
      /(?:^|[/\\])(?:AGENTS|CLAUDE)\.md$/i.test(file) ||
      file.includes(`${path.sep}fixtures${path.sep}`)
    )
      continue;
    checkLinks(file, fs.readFileSync(file, "utf8"));
  }
  for (const pair of pairManifest) checkPair(...pair);
  return [...errors];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = validateDocumentation();
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  } else
    console.log(`Documentation links and ${pairManifest.length} bilingual README pairs are valid.`);
}
