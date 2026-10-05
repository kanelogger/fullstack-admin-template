/* eslint-disable no-unsafe-finally -- Cleanup failures must fail isolated Auth acceptance. */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import {
  captureCleanupFailure,
  localSupabaseStatus,
  stopLocalEdgeServer,
  waitForFunctions
} from "./helpers/local-edge-functions";

const frontendRoot = process.cwd();
const repositoryRoot = resolve(process.env.SUPABASE_PROJECT_ROOT ?? resolve(frontendRoot, ".."));
const supabaseCli = resolve(frontendRoot, "node_modules/.bin/supabase");

test("isolated template default administrator can sign in", async ({ page }) => {
  test.setTimeout(45_000);
  test.skip(process.env.E2E_TEMPLATE_ADMIN !== "1", "Enabled by the isolated migration acceptance flow");

  const { url, publishableKey, serviceRoleKey } = localSupabaseStatus({
    frontendRoot,
    repositoryRoot,
    supabaseCli
  });
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const auditStartAt = new Date().toISOString();
  const edgeServer = spawn(supabaseCli, ["--workdir", repositoryRoot, "functions", "serve", "--no-verify-jwt"], {
    cwd: frontendRoot,
    stdio: "ignore",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
  });
  let testFailure: unknown;
  let testFailed = false;
  try {
    await waitForFunctions(edgeServer, url, publishableKey);
    await page.goto("/#/login");
    await page.getByRole("textbox", { name: "账号" }).fill("admin");
    await page.getByRole("textbox", { name: "密码" }).fill("admin123456");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByRole("heading", { name: "系统概览" })).toBeVisible();
    process.stdout.write(`${JSON.stringify({ defaultAdminLogin: true })}\n`);
  } catch (error) {
    testFailed = true;
    testFailure = error;
  } finally {
    const cleanupFailures: Error[] = [];
    await captureCleanupFailure(cleanupFailures, "Could not clean the default-admin login audit fixture", async () => {
      const { error } = await admin
        .from("login_logs")
        .delete()
        .in("login_name", ["admin", "__codex_edge_readiness__"])
        .gte("logged_at", auditStartAt);
      if (error) throw error;
    });
    await captureCleanupFailure(cleanupFailures, "Could not close the Supabase Realtime client", () => {
      admin.realtime.disconnect();
    });
    await captureCleanupFailure(cleanupFailures, "Could not stop the local Edge Functions subprocess", () =>
      stopLocalEdgeServer(edgeServer)
    );
    if (cleanupFailures.length) {
      if (testFailed) {
        throw new AggregateError([testFailure, ...cleanupFailures], "Default-admin Auth E2E and cleanup failed");
      }
      throw new AggregateError(cleanupFailures, "Default-admin Auth E2E cleanup failed");
    }
    if (testFailed) throw testFailure;
  }
});
