import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { selectMigrationTrack, syncBaselineMigrations } from "./template-migrations.mjs";

const cutoff = "20261005084413";
const baselineFile = `${cutoff}_template_baseline.sql`;
const legacyFile = `${cutoff}_template_last_history.sql`;

async function createMigrationRoot() {
  const root = await mkdtemp(join(os.tmpdir(), "template-migrations-test-"));
  const history = join(root, "supabase/migrations");
  const baseline = join(root, "supabase/baselines", cutoff);
  const baselineMigrations = join(baseline, "migrations");
  await mkdir(history, { recursive: true });
  await mkdir(baselineMigrations, { recursive: true });
  await writeFile(join(root, "supabase/config.toml"), 'project_id = "fullstack-admin-template"\n');
  await writeFile(join(history, legacyFile), "-- historical cutoff\n");
  const baselineContents = "-- immutable published baseline\n";
  await writeFile(join(baselineMigrations, baselineFile), baselineContents);
  await writeFile(join(baseline, "metadata.json"), `${JSON.stringify({
    schemaVersion: 1,
    cutoff,
    migration: `migrations/${baselineFile}`,
    sha256: createHash("sha256").update(baselineContents).digest("hex")
  }, null, 2)}\n`);
  return root;
}

test("sync mirrors later migrations byte-for-byte and refuses to overwrite a differing copy", async () => {
  const root = await createMigrationRoot();
  const sharedName = "20261006000000_add_example.sql";
  try {
    await writeFile(join(root, "supabase/migrations", sharedName), "create table example (id integer);\n");
    const first = await syncBaselineMigrations(root);
    assert.deepEqual(first.copied, [sharedName]);
    assert.equal(
      await readFile(join(root, "supabase/baselines", cutoff, "migrations", sharedName), "utf8"),
      await readFile(join(root, "supabase/migrations", sharedName), "utf8")
    );
    assert.deepEqual((await syncBaselineMigrations(root)).copied, []);

    await writeFile(join(root, "supabase/migrations", sharedName), "create table example (id text);\n");
    await assert.rejects(syncBaselineMigrations(root), /differs between tracks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("baseline selection archives history, materializes the baseline, and forbids switching tracks", async () => {
  const root = await createMigrationRoot();
  const sharedName = "20261006000000_add_example.sql";
  try {
    await writeFile(join(root, "supabase/migrations", sharedName), "create table example (id integer);\n");
    const result = await selectMigrationTrack({ root, track: "baseline", dockerRead: async () => "" });
    assert.equal(result.status, "selected");
    const active = await readdir(join(root, "supabase/migrations"));
    assert.deepEqual(active, [baselineFile, sharedName]);
    assert.deepEqual(await readdir(join(root, ".template/migration-history", `history-through-${cutoff}`)), [legacyFile, sharedName]);
    const marker = JSON.parse(await readFile(join(root, ".template/migration-track.json"), "utf8"));
    assert.deepEqual(marker, { schemaVersion: 1, track: "baseline", baselineVersion: cutoff });
    await assert.rejects(
      selectMigrationTrack({ root, track: "history", dockerRead: async () => "" }),
      /migration tracks are immutable/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migration selection fails closed on a Docker probe error and preserves the active directory", async () => {
  const root = await createMigrationRoot();
  try {
    await assert.rejects(
      selectMigrationTrack({ root, track: "baseline", dockerRead: async () => { throw new Error("Docker is unreadable"); } }),
      /Docker is unreadable/
    );
    assert.deepEqual(await readdir(join(root, "supabase/migrations")), [legacyFile]);
    await assert.rejects(readFile(join(root, ".template/migration-track.json")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a baseline project receives shared migrations without replacing the published baseline", async () => {
  const sourceRoot = await createMigrationRoot();
  const projectRoot = await createMigrationRoot();
  const sharedName = "20261006000000_add_example.sql";
  const nextName = "20261007000000_add_next_example.sql";
  try {
    const content = "create table example (id integer);\n";
    await writeFile(join(sourceRoot, "supabase/migrations", sharedName), content);
    const sync = await syncBaselineMigrations(sourceRoot);
    assert.deepEqual(sync.copied, [sharedName]);
    await cp(join(sourceRoot, "supabase/baselines"), join(projectRoot, "supabase/baselines"), { recursive: true });
    await writeFile(join(projectRoot, "supabase/migrations", sharedName), content);
    await selectMigrationTrack({ root: projectRoot, track: "baseline", dockerRead: async () => "" });

    const nextContent = "create table next_example (id integer);\n";
    await writeFile(join(sourceRoot, "supabase/migrations", nextName), nextContent);
    await syncBaselineMigrations(sourceRoot);
    await cp(
      join(sourceRoot, "supabase/baselines", cutoff, "migrations", nextName),
      join(projectRoot, "supabase/baselines", cutoff, "migrations", nextName)
    );

    const projectSync = await selectMigrationTrack({ root: projectRoot, track: "baseline", dockerRead: async () => "" });
    assert.deepEqual(projectSync.copied, [nextName]);
    assert.equal(await readFile(join(projectRoot, "supabase/migrations", nextName), "utf8"), nextContent);
    assert.equal(await readFile(join(projectRoot, "supabase/baselines", cutoff, "migrations", baselineFile), "utf8"), "-- immutable published baseline\n");
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});
