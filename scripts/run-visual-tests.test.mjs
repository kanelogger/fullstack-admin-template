import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareVisualContainerWorkspace } from "./run-visual-tests.mjs";

test("visual container workspace owns the pnpm mount before Docker creates it", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "visual-mount-"));
  try {
    await prepareVisualContainerWorkspace(root);
    const mount = join(root, "node_modules", ".pnpm-store", "v11");
    const info = await stat(mount);
    assert.equal(info.isDirectory(), true);
    assert.equal(info.uid, process.getuid());
    const slot = join(root, "node_modules", ".pnpm", "slot");
    await mkdir(join(root, "node_modules", ".pnpm"));
    await writeFile(slot, "ok");
    assert.equal((await stat(slot)).uid, process.getuid());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
