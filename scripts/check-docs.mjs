import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const activeMarkdownRoots = [
  "README.md",
  "AGENTS.md",
  "AI_ENVIRONMENT.md",
  "docs",
  "rules",
  "specs",
  "tasks/README.md"
];
const packageManagerCommands = new Set([
  "add", "config", "deploy", "dlx", "env", "exec", "install", "link",
  "pack", "patch", "publish", "remove", "run", "store", "update",
  "why", "--version"
]);

export function extractLocalMarkdownLinks(markdown) {
  const links = [];
  const pattern = /!?(?:\[[^\]]*\])\((<[^>]+>|[^)]+)\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const raw = match[1].startsWith("<")
      ? match[1].slice(1, -1)
      : match[1].trim().split(/\s+/, 1)[0];
    if (!raw || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw) || raw.startsWith("#")) continue;
    const path = raw.split(/[?#]/, 1)[0];
    if (!path) continue;
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(path);
    } catch {
      decodedPath = path;
    }
    links.push(decodedPath);
  }
  return links;
}

export function extractPnpmScriptReferences(markdown) {
  const references = new Set();
  const segments = [...markdown.matchAll(/```([\w-]*)\s*\n([\s\S]*?)```|`([^`]+)`/g)]
    .filter(match => match[3] || ["sh", "bash", "shell", "zsh", "console"].includes(match[1]))
    .map(match => match[3] ?? match[2]);
  for (const segment of segments) {
    for (const match of segment.matchAll(/\bpnpm\s+([\w:-]+)/g)) {
      const command = match[1];
      if (/^\d/.test(command) || command.includes("/") || packageManagerCommands.has(command)) continue;
      references.add(command);
    }
  }
  return references;
}

async function collectMarkdown(path) {
  const absolutePath = join(projectRoot, path);
  if (extname(path).toLowerCase() === ".md") {
    await access(absolutePath);
    return [path];
  }
  const info = await readdir(absolutePath, { withFileTypes: true });
  const paths = [];
  for (const entry of info) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) paths.push(...await collectMarkdown(child));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") paths.push(child);
  }
  return paths;
}

async function checkDocs() {
  const markdownFiles = [...new Set((await Promise.all(activeMarkdownRoots.map(collectMarkdown))).flat())];
  const packageFiles = ["package.json", "frontend/package.json", "supabase/functions/_shared/contracts/package.json"];
  const knownScripts = new Set();
  for (const file of packageFiles) {
    try {
      const manifest = JSON.parse(await readFile(join(projectRoot, file), "utf8"));
      for (const script of Object.keys(manifest.scripts ?? {})) knownScripts.add(script);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const failures = [];
  for (const file of markdownFiles) {
    const markdown = await readFile(join(projectRoot, file), "utf8");
    for (const localLink of extractLocalMarkdownLinks(markdown)) {
      const target = isAbsolute(localLink) ? localLink : resolve(projectRoot, dirname(file), localLink);
      try {
        await access(target);
      } catch {
        failures.push(`${file}: missing local link target ${localLink}`);
      }
    }
    for (const command of extractPnpmScriptReferences(markdown)) {
      if (!knownScripts.has(command)) failures.push(`${file}: unknown pnpm script ${command}`);
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
  console.log(`Checked ${markdownFiles.length} active Markdown files and ${knownScripts.size} workspace scripts.`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  checkDocs().catch(error => {
    console.error(error instanceof Error ? error.message : "Documentation checks failed");
    process.exitCode = 1;
  });
}
