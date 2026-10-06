import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  applyAtomicFileChanges,
  assertNoSupabaseRuntimeState,
  inspectProjectInitializationRecovery,
  recoverProjectInitialization
} from "./template-bootstrap-helpers.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultProjectId = "fullstack-admin-template";
const defaultTitle = "Admin";

export function validateProjectId(projectId) {
  if (!/^[a-z][a-z0-9-]{2,62}$/.test(projectId)) {
    throw new Error("Project ID must be 3-63 lowercase letters, numbers, or hyphens, and start with a letter.");
  }
  if (projectId === defaultProjectId) throw new Error("Choose a new project ID instead of the template default.");
  return projectId;
}

export function validateProjectTitle(title) {
  const normalized = title.trim();
  const containsControlCharacter = [...normalized].some(character => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
  if (!normalized || normalized.length > 80 || containsControlCharacter) {
    throw new Error("Project title must contain 1-80 visible characters and no control characters.");
  }
  return normalized;
}

export function buildProjectInitChanges({ supabaseConfig, platformConfigText, indexHtml }, { projectId, title }) {
  const projectIdLines = [...supabaseConfig.matchAll(/^project_id\s*=\s*"([^"]+)"\s*$/gm)];
  if (projectIdLines.length !== 1 || projectIdLines[0][1] !== defaultProjectId) {
    throw new Error("supabase/config.toml is not at the template project ID; initialization only runs once.");
  }

  const platformConfig = JSON.parse(platformConfigText);
  if (platformConfig.Title !== defaultTitle) {
    throw new Error("frontend/public/platform-config.json Title is not the template default.");
  }
  const titleMatches = [...indexHtml.matchAll(/<title>Admin<\/title>/g)];
  if (titleMatches.length !== 1) throw new Error("frontend/index.html title is not the template default.");

  const updatedConfig = supabaseConfig.replace(
    /^project_id\s*=\s*"fullstack-admin-template"\s*$/m,
    `project_id = "${projectId}"`
  );
  platformConfig.Title = title;
  const updatedHtml = indexHtml.replace("<title>Admin</title>", `<title>${escapeHtml(title)}</title>`);
  return {
    "supabase/config.toml": updatedConfig,
    "frontend/public/platform-config.json": `${JSON.stringify(platformConfig, null, 2)}\n`,
    "frontend/index.html": updatedHtml,
    ".template/project.json": `${JSON.stringify({ schemaVersion: 1, projectId, title }, null, 2)}\n`
  };
}

function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function existingProjectMarker(root) {
  try {
    return JSON.parse(await readFile(resolve(root, ".template/project.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Cannot read .template/project.json: ${error instanceof Error ? error.message : "invalid file"}`, { cause: error });
  }
}

export async function runTemplateInit({
  root = projectRoot,
  projectId: rawProjectId,
  title: rawTitle,
  dryRun = false,
  dockerRead
}) {
  const projectId = validateProjectId(rawProjectId);
  const title = validateProjectTitle(rawTitle);
  if (dryRun) {
    const recovery = await inspectProjectInitializationRecovery(root);
    if (recovery.recoveryRequired) {
      return { status: "recovery-required", changes: [], recovery };
    }
  } else {
    await recoverProjectInitialization(root);
  }
  const marker = await existingProjectMarker(root);
  if (marker) {
    if (marker.projectId === projectId && marker.title === title) {
      const config = await readFile(resolve(root, "supabase/config.toml"), "utf8");
      const platform = JSON.parse(await readFile(resolve(root, "frontend/public/platform-config.json"), "utf8"));
      const html = await readFile(resolve(root, "frontend/index.html"), "utf8");
      const projectIdMatches = new RegExp(`^project_id\\s*=\\s*"${projectId}"\\s*$`, "m").test(config);
      const titleMatches = [...html.matchAll(/<title>(.*?)<\/title>/g)];
      if (
        projectIdMatches &&
        platform.Title === title &&
        titleMatches.length === 1 &&
        titleMatches[0][1] === escapeHtml(title)
      ) {
        return { status: "already-initialized", changes: [] };
      }
      throw new Error("Initialization marker and project files disagree; refusing to overwrite manual changes.");
    }
    throw new Error("This checkout is already initialized; use project configuration files for intentional changes.");
  }

  const [supabaseConfig, platformConfigText, indexHtml] = await Promise.all([
    readFile(resolve(root, "supabase/config.toml"), "utf8"),
    readFile(resolve(root, "frontend/public/platform-config.json"), "utf8"),
    readFile(resolve(root, "frontend/index.html"), "utf8")
  ]);
  const changes = buildProjectInitChanges(
    { supabaseConfig, platformConfigText, indexHtml },
    { projectId, title }
  );
  await assertNoSupabaseRuntimeState({
    projectRoot: root,
    projectIds: [defaultProjectId, projectId],
    ...(dockerRead ? { dockerRead } : {})
  });

  if (dryRun) return { status: "dry-run", changes: Object.keys(changes) };
  await applyAtomicFileChanges(root, changes);
  return { status: "initialized", changes: Object.keys(changes) };
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--dry-run") {
      values.dryRun = true;
      continue;
    }
    if (flag !== "--project-id" && flag !== "--title") throw new Error(`Unknown argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    values[flag === "--project-id" ? "projectId" : "title"] = value;
    index += 1;
  }
  if (!values.projectId || !values.title) {
    throw new Error("Usage: pnpm template:init -- --project-id <id> --title <title> [--dry-run]");
  }
  return values;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  runTemplateInit(parseArguments(process.argv.slice(2).filter(argument => argument !== "--")))
    .then(result => {
      for (const change of result.changes) console.log(`${result.status}: ${change}`);
      if (result.status === "already-initialized") console.log("Project already has this configuration.");
      if (result.status === "recovery-required") {
        const paths = [
          ...(result.recovery.journalPresent ? [".template/init-journal.json"] : []),
          ...result.recovery.backupDirectories
        ];
        console.log(`Dry run found pending initialization recovery and made no changes: ${paths.join(", ")}`);
      }
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : "Template initialization failed");
      process.exitCode = 1;
    });
}
