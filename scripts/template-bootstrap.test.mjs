import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyAtomicFileChanges,
  assertNoSupabaseRuntimeState
} from "./template-bootstrap-helpers.mjs";
import {
  buildProjectInitChanges,
  runTemplateInit,
  validateProjectId,
  validateProjectTitle
} from "./template-init.mjs";

const originalFiles = {
  "supabase/config.toml": 'project_id = "fullstack-admin-template"\n',
  "frontend/public/platform-config.json": '{\n  "Title": "Admin"\n}\n',
  "frontend/index.html": "<html><head><title>Admin</title></head><body></body></html>\n"
};

async function createTemplateRoot() {
  const root = await mkdtemp(join(os.tmpdir(), "template-init-test-"));
  for (const [path, content] of Object.entries(originalFiles)) {
    const target = join(root, path);
    await mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

test("initializer validates IDs and titles", () => {
  assert.equal(validateProjectId("customer-admin-01"), "customer-admin-01");
  assert.equal(validateProjectTitle("  Customer Admin  "), "Customer Admin");
  assert.throws(() => validateProjectId("Fullstack Admin"));
  assert.throws(() => validateProjectId("fullstack-admin-template"));
  assert.throws(() => validateProjectTitle("\u0000"));
  assert.throws(() => validateProjectTitle("x".repeat(81)));
});

test("dry-run and apply use the same computed file set; apply is idempotent", async () => {
  const root = await createTemplateRoot();
  try {
    const dockerRead = async () => "";
    const dryRun = await runTemplateInit({ root, projectId: "customer-admin", title: "Customer Admin", dryRun: true, dockerRead });
    assert.equal(dryRun.status, "dry-run");
    assert.deepEqual(dryRun.changes, [
      "supabase/config.toml",
      "frontend/public/platform-config.json",
      "frontend/index.html",
      ".template/project.json"
    ]);
    assert.equal(await readFile(join(root, "supabase/config.toml"), "utf8"), originalFiles["supabase/config.toml"]);

    const result = await runTemplateInit({ root, projectId: "customer-admin", title: "Customer Admin", dockerRead });
    assert.equal(result.status, "initialized");
    assert.match(await readFile(join(root, "supabase/config.toml"), "utf8"), /project_id = "customer-admin"/);
    assert.match(await readFile(join(root, "frontend/index.html"), "utf8"), /<title>Customer Admin<\/title>/);
    assert.deepEqual(await runTemplateInit({ root, projectId: "customer-admin", title: "Customer Admin" }), {
      status: "already-initialized",
      changes: []
    });
    await assert.rejects(runTemplateInit({ root, projectId: "customer-admin", title: "Different Title" }), /already initialized/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dry-run reports a pending recovery journal without restoring files or deleting recovery data", async () => {
  const root = await createTemplateRoot();
  try {
    const configPath = join(root, "supabase/config.toml");
    const journalPath = join(root, ".template/init-journal.json");
    const backupPath = join(root, ".template/.init-backup-interrupted");
    await mkdir(join(root, ".template"), { recursive: true });
    await mkdir(backupPath, { recursive: true });
    await writeFile(configPath, 'project_id = "customer-admin"\n');
    await writeFile(journalPath, JSON.stringify({
      schemaVersion: 1,
      changes: [{
        path: "supabase/config.toml",
        existed: true,
        originalContents: originalFiles["supabase/config.toml"]
      }]
    }));

    const result = await runTemplateInit({
      root,
      projectId: "customer-admin",
      title: "Customer Admin",
      dryRun: true
    });

    assert.equal(result.status, "recovery-required");
    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.recovery, {
      journalPresent: true,
      backupDirectories: [".template/.init-backup-interrupted"],
      recoveryRequired: true
    });
    assert.equal(await readFile(configPath, "utf8"), 'project_id = "customer-admin"\n');
    assert.equal(await readFile(journalPath, "utf8"), JSON.stringify({
      schemaVersion: 1,
      changes: [{
        path: "supabase/config.toml",
        existed: true,
        originalContents: originalFiles["supabase/config.toml"]
      }]
    }));
    assert.deepEqual(await (await import("node:fs/promises")).readdir(backupPath), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("initializer refuses when Docker probing fails or a stopped-project volume remains", async () => {
  const root = await createTemplateRoot();
  try {
    await assert.rejects(
      runTemplateInit({ root, projectId: "customer-admin", title: "Customer Admin", dockerRead: async () => { throw new Error("probe failed"); } }),
      /probe failed/
    );
    await assert.rejects(
      runTemplateInit({ root, projectId: "customer-admin", title: "Customer Admin", dockerRead: async args => args[0] === "volume" ? "project_customer-admin_db" : "" }),
      /volumes: project_customer-admin_db/
    );
    assert.equal(await readFile(join(root, "supabase/config.toml"), "utf8"), originalFiles["supabase/config.toml"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("initializer rejects retained Supabase Local metadata even when Docker reports no running stack", async () => {
  const root = await createTemplateRoot();
  try {
    await mkdir(join(root, "supabase/.temp"), { recursive: true });
    await assert.rejects(
      assertNoSupabaseRuntimeState({ projectRoot: root, projectIds: ["customer-admin"], dockerRead: async () => "" }),
      /Local Supabase state exists/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("multi-file initialization rolls earlier writes back if a later write fails", async () => {
  const root = await createTemplateRoot();
  try {
    const configPath = join(root, "supabase/config.toml");
    const htmlPath = join(root, "frontend/index.html");
    const changes = buildProjectInitChanges({
      supabaseConfig: originalFiles["supabase/config.toml"],
      platformConfigText: originalFiles["frontend/public/platform-config.json"],
      indexHtml: originalFiles["frontend/index.html"]
    }, { projectId: "customer-admin", title: "Customer Admin" });
    let failOnce = true;
    const injectedWrite = async (path, contents) => {
      if (path === htmlPath && failOnce && contents.includes("Customer Admin")) {
        failOnce = false;
        throw new Error("injected second-file write failure");
      }
      await writeFile(path, contents);
    };
    await assert.rejects(applyAtomicFileChanges(root, changes, { writeFile: injectedWrite }), /injected second-file/);
    assert.equal(await readFile(configPath, "utf8"), originalFiles["supabase/config.toml"]);
    assert.equal(await readFile(htmlPath, "utf8"), originalFiles["frontend/index.html"]);
    await assert.rejects(readFile(join(root, ".template/project.json")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
