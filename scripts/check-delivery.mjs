import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requiredSections = [
  "## 发布顺序",
  "## 迁移失败",
  "## 密钥、邮件与域名",
  "## 备份恢复",
  "## 故障诊断"
];
const secretAssignment = /^\s*[A-Za-z0-9_]*SERVICE_ROLE[A-Za-z0-9_]*\s*=\s*\S+/i;
const hostedSecret = /sb_secret_[A-Za-z0-9_-]+/;
const productionDeployPattern = /supabase\s+(db\s+push|link)|functions\s+deploy/i;
const skipDirectories = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".agents",
  "test-results",
  "playwright-report"
]);
const requiredEnvFiles = [
  "frontend/.env.example",
  "frontend/.env.development.example",
  "frontend/.env.staging.example",
  "frontend/.env.production.example"
];

export async function collectEnvFiles(directory, relative = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (skipDirectories.has(entry.name)) continue;
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collectEnvFiles(join(directory, entry.name), childRelative));
    } else if (entry.isFile() && entry.name.startsWith(".env")) {
      files.push(childRelative);
    }
  }
  return files;
}

function isGitIgnored(repositoryRoot, relativePath) {
  const result = spawnSync("git", ["check-ignore", "-q", "--", relativePath], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  return result.status === 0;
}

function envFileHasServerSecret(text) {
  return text.split("\n").some(line => secretAssignment.test(line) || hostedSecret.test(line));
}

export async function checkDelivery(repositoryRoot = root) {
  const errors = [];
  const delivery = await readFile(join(repositoryRoot, "docs/delivery.md"), "utf8");
  for (const section of requiredSections) {
    if (!delivery.includes(section)) errors.push(`docs/delivery.md is missing ${section}`);
  }
  for (const path of ["specs/architecture.md", "docs/agent-environment/ci-parity.md", "AI_ENVIRONMENT.md"]) {
    const text = await readFile(join(repositoryRoot, path), "utf8");
    if (!text.includes("docs/delivery.md")) errors.push(`${path} does not reference docs/delivery.md`);
  }

  const packageManifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  if (packageManifest.scripts?.["check:delivery"] !== "node scripts/check-delivery.mjs") {
    errors.push("package.json must expose check:delivery");
  }
  const workflow = await readFile(join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
  if (!workflow.includes("pnpm check:delivery")) errors.push("CI does not run pnpm check:delivery");
  if (productionDeployPattern.test(workflow)) errors.push("CI contains a production deploy command");

  const envFiles = (await collectEnvFiles(repositoryRoot))
    .filter(path => !isGitIgnored(repositoryRoot, path));
  for (const path of requiredEnvFiles) {
    if (!envFiles.includes(path)) errors.push(`${path} was not scanned`);
  }
  for (const path of envFiles) {
    const text = await readFile(join(repositoryRoot, path), "utf8");
    if (envFileHasServerSecret(text)) errors.push(`${path} contains a server secret`);
  }

  const migrations = (await readdir(join(repositoryRoot, "supabase/migrations")))
    .filter(name => name.endsWith(".sql"))
    .sort();
  const versions = migrations.map(name => {
    const match = name.match(/^(\d{14})_[a-z0-9_]+\.sql$/);
    if (!match) errors.push(`Invalid migration filename: ${name}`);
    return match?.[1] ?? "";
  });
  if (versions.some((version, index) => index > 0 && version <= versions[index - 1])) {
    errors.push("Migration filenames are not strictly ordered");
  }

  return { valid: errors.length === 0, errors };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  checkDelivery().then(result => {
    if (!result.valid) {
      process.stderr.write(`${result.errors.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write("Delivery convention is present. CI has no production deploy command, and workspace env files contain no server secret.\n");
  }).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
