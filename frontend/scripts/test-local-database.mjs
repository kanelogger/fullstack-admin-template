import { cleanupFixtures, ensureFixtures, ensureMessageFixtures, ensureOrganizationFixtures, getLocalAdminClient, runSupabase } from "./local-database/shared.mjs";
import { testForcedResetEmail } from "./local-database/auth.mjs";
import { testAttachmentStorageAccess } from "./local-database/attachments.mjs";

let admin;
let localUrl;
let publishableKey;
let fixtureSetupStarted = false;
let exitCode = 0;

try {
  const local = getLocalAdminClient();
  admin = local.client;
  localUrl = local.url;
  publishableKey = local.publishableKey;
  fixtureSetupStarted = true;
  await ensureFixtures(admin);
  await ensureMessageFixtures(admin);
  await ensureOrganizationFixtures(admin);

  const testRun = runSupabase(["test", "db", "--local"], { inherit: true });
  if (testRun.status !== 0) exitCode = testRun.status ?? 1;
  if (exitCode === 0) {
    await testForcedResetEmail(localUrl, publishableKey, admin);
    await testAttachmentStorageAccess(localUrl, publishableKey, admin);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local database tests failed");
  exitCode = 1;
} finally {
  if (admin && fixtureSetupStarted) {
    try {
      await cleanupFixtures(admin);
      console.log("Local RLS fixtures cleaned");
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Local RLS cleanup failed");
      exitCode = 1;
    }
  }
  if (admin) admin.realtime.disconnect();
}

process.exitCode = exitCode;
