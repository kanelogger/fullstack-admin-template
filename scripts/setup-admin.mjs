import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  BootstrapAdminInputSchema,
  BootstrapAdminResultSchema
} from "@template/contracts/bootstrap";
import {
  BOOTSTRAP_METADATA_KEY,
  bootstrapMarker,
  isEmailConflict,
  matchesBootstrapMarker
} from "./bootstrap-admin-helpers.mjs";
import { getLocalSupabaseStatus, projectRoot } from "./local-supabase.mjs";

async function findBootstrapUser(admin, input) {
  for (let page = 1; page <= 1000; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Could not inspect local Auth identities");
    const matchingEmail = data.users.find(user => user.email?.toLowerCase() === input.email.toLowerCase());
    if (matchingEmail) {
      if (isEmailConflict(matchingEmail, input)) {
        throw new Error("This email already belongs to an account that was not created by initial-admin setup");
      }
      if (matchesBootstrapMarker(matchingEmail, input)) return matchingEmail;
    }
    if (data.users.length < 1000) return null;
  }
  throw new Error("Auth identity list exceeded the safety limit");
}

async function removeUncommittedIdentity(admin, authUserId) {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (profileError || profile) return false;
  const { error } = await admin.auth.admin.deleteUser(authUserId);
  return !error;
}

async function setup(input) {
  const { url, serviceRoleKey } = getLocalSupabaseStatus();
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let authUser = await findBootstrapUser(admin, input);
  const createdThisRun = !authUser;
  if (!authUser) {
    const initialPassword = `${randomBytes(48).toString("base64url")}aA1!`;
    const { data, error } = await admin.auth.admin.createUser({
      email: input.email,
      password: initialPassword,
      email_confirm: true,
      app_metadata: {
        [BOOTSTRAP_METADATA_KEY]: bootstrapMarker(input)
      }
    });
    if (error || !data.user) throw new Error("Could not create local Auth identity");
    authUser = data.user;
  }

  const { data: bootstrapData, error: bootstrapError } = await admin.rpc(
    "bootstrap_first_admin_profile",
    {
      p_auth_user_id: authUser.id,
      p_login_name: input.loginName,
      p_display_name: input.displayName,
      p_email: input.email
    }
  );
  if (bootstrapError) {
    if (createdThisRun && !await removeUncommittedIdentity(admin, authUser.id)) {
      throw new Error("Bootstrap failed; the local Auth identity was preserved because its profile state could not be verified");
    }
    if (createdThisRun) throw new Error("Bootstrap failed and the uncommitted Auth identity was removed");
    throw new Error("Bootstrap retry failed; the marked local Auth identity was preserved for retry");
  }

  const result = BootstrapAdminResultSchema.parse(bootstrapData);
  const completeMarker = bootstrapMarker(input, "complete");
  const { error: metadataError } = await admin.auth.admin.updateUserById(authUser.id, {
    app_metadata: { ...authUser.app_metadata, [BOOTSTRAP_METADATA_KEY]: completeMarker }
  });
  if (metadataError) throw new Error("Administrator exists, but bootstrap completion could not be recorded; rerun setup-admin");

  if (!result.mustResetPassword) {
    console.log("The initial administrator is already set up and has completed password reset.");
    return;
  }

  const { data: marked, error: markerError } = await admin.rpc(
    "mark_password_reset_requested",
    { p_auth_user_id: authUser.id }
  );
  if (markerError || marked !== true) {
    throw new Error("Administrator exists; password-reset setup is pending. Rerun setup-admin after correcting the local database state.");
  }
  const { error: resetError } = await admin.auth.resetPasswordForEmail(input.email, {
    redirectTo: "http://127.0.0.1:8848/#/reset-password"
  });
  if (resetError) {
    throw new Error("Administrator exists and is protected; Mailpit delivery failed. Start local mail services and rerun setup-admin to retry.");
  }
  console.log(`Initial administrator ${input.loginName} is ready. Set the password using the Mailpit message for ${input.email}.`);
  console.log(`Business profile ID: ${result.id}`);
}

async function main() {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("Run setup-admin in an interactive terminal");
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const input = BootstrapAdminInputSchema.parse({
      loginName: await prompt.question("Login name: "),
      displayName: await prompt.question("Display name: "),
      email: await prompt.question("Email for password setup: ")
    });
    await setup(input);
  } finally {
    prompt.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Initial-admin setup failed");
  process.exitCode = 1;
});
