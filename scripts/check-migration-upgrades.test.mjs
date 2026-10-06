import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { withUpgradeWorkspace } from "./check-migration-upgrades.mjs";

test("migration upgrade diagnostics survive a stack-stop failure and normal workspaces are removed", async () => {
  const retainedRoot = await mkdtemp(join(os.tmpdir(), "migration-upgrade-retained-"));
  const diagnosticPath = join(retainedRoot, "diagnostic.txt");
  await writeFile(diagnosticPath, "stack stop failed");
  try {
    await assert.rejects(withUpgradeWorkspace(
      retainedRoot,
      async retainWorkspace => {
        retainWorkspace();
        throw new Error("stack stop failed");
      },
      { onRetain: () => undefined }
    ), /stack stop failed/);
    assert.equal(await readFile(diagnosticPath, "utf8"), "stack stop failed");
  } finally {
    await rm(retainedRoot, { recursive: true, force: true });
  }

  const cleanedRoot = await mkdtemp(join(os.tmpdir(), "migration-upgrade-cleaned-"));
  await withUpgradeWorkspace(cleanedRoot, async () => "complete");
  await assert.rejects(stat(cleanedRoot), { code: "ENOENT" });
});
