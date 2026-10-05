import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { BootstrapAdminResultSchema } from "@template/contracts/bootstrap";
import { bootstrapMarker, BOOTSTRAP_METADATA_KEY } from "./bootstrap-admin-helpers.mjs";
import { getLocalSupabaseStatus, projectRoot } from "./local-supabase.mjs";

const { url, serviceRoleKey } = getLocalSupabaseStatus(
  process.env.SUPABASE_PROJECT_ROOT ?? projectRoot
);
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
const identities = [
  {
    loginName: `__codex_bootstrap_${suffix}_a`,
    displayName: "Disposable bootstrap winner",
    email: `__codex_bootstrap_${suffix}_a@example.test`
  },
  {
    loginName: `__codex_bootstrap_${suffix}_b`,
    displayName: "Disposable bootstrap candidate",
    email: `__codex_bootstrap_${suffix}_b@example.test`
  },
  {
    loginName: `__codex_bootstrap_${suffix}_ordinary`,
    displayName: "Disposable ordinary account",
    email: `__codex_bootstrap_${suffix}_ordinary@example.test`
  }
];
const mailpitUrl = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";
const authUserIds = [];
const profileIds = [];

async function createAuthUser(identity) {
  const { data, error } = await admin.auth.admin.createUser({
    email: identity.email,
    password: `${randomUUID()}Aa1!`,
    email_confirm: true,
    app_metadata: { [BOOTSTRAP_METADATA_KEY]: bootstrapMarker(identity) }
  });
  if (error || !data.user) throw new Error("Could not create a disposable bootstrap Auth identity");
  authUserIds.push(data.user.id);
  return data.user;
}

async function cleanup() {
  if (profileIds.length) {
    await admin.from("user_roles").delete().in("user_id", profileIds);
    const { error } = await admin.from("profiles").delete().in("id", profileIds);
    if (error) throw new Error("Could not clean bootstrap profile fixtures");
  }
  for (const authUserId of authUserIds) {
    const { error } = await admin.auth.admin.deleteUser(authUserId);
    if (error) throw new Error("Could not clean bootstrap Auth fixtures");
  }
}

try {
  const candidates = await Promise.all(identities.slice(0, 2).map(createAuthUser));
  const results = await Promise.allSettled(candidates.map((user, index) =>
    admin.rpc("bootstrap_first_admin_profile", {
      p_auth_user_id: user.id,
      p_login_name: identities[index].loginName,
      p_display_name: identities[index].displayName,
      p_email: identities[index].email
    })
  ));
  const successful = results
    .map((result, index) => ({ result, index }))
    .filter(item => item.result.status === "fulfilled" && !item.result.value.error);
  assert.equal(successful.length, 1, "a concurrent first-admin race must create one winner");
  const winner = successful[0];
  if (winner.result.status !== "fulfilled") throw new Error("The bootstrap winner could not be determined");
  const winnerAuth = candidates[winner.index];
  const winnerIdentity = identities[winner.index];
  const bootstrap = BootstrapAdminResultSchema.parse(winner.result.value.data);
  assert.equal(bootstrap.mustResetPassword, true);
  profileIds.push(bootstrap.id);

  const { data: mappedProfile, error: profileError } = await admin
    .from("profiles")
    .select("id,auth_user_id,login_name,display_name,email,is_active,must_reset_password")
    .eq("auth_user_id", winnerAuth.id)
    .single();
  if (profileError || !mappedProfile) throw new Error("The winning bootstrap profile was not stored");
  assert.equal(String(mappedProfile.id), bootstrap.id);
  assert.equal(mappedProfile.login_name, winnerIdentity.loginName);
  assert.equal(mappedProfile.must_reset_password, true);

  const replay = await admin.rpc("bootstrap_first_admin_profile", {
    p_auth_user_id: winnerAuth.id,
    p_login_name: winnerIdentity.loginName,
    p_display_name: winnerIdentity.displayName,
    p_email: winnerIdentity.email
  });
  assert.equal(replay.error, null, "an identical bootstrap identity must be idempotent");
  assert.equal(BootstrapAdminResultSchema.parse(replay.data).id, bootstrap.id);

  const loser = results.findIndex(result => result.status === "rejected" || (result.status === "fulfilled" && result.value.error));
  assert.notEqual(loser, winner.index, "the competing Auth identity cannot also become administrator");

  const ordinaryAuth = await createAuthUser(identities[2]);
  const { data: commonRole, error: commonRoleError } = await admin
    .from("roles")
    .select("id")
    .eq("code", "COMMON_USER")
    .single();
  if (commonRoleError || !commonRole) throw new Error("Seeded COMMON_USER role is missing");
  const { data: ordinaryProfile, error: ordinaryProfileError } = await admin
    .from("profiles")
    .insert({
      auth_user_id: ordinaryAuth.id,
      user_code: identities[2].loginName,
      login_name: identities[2].loginName,
      display_name: identities[2].displayName,
      email: identities[2].email,
      is_active: true,
      must_reset_password: false
    })
    .select("id")
    .single();
  if (ordinaryProfileError || !ordinaryProfile) throw new Error("Could not create the ordinary account fixture");
  profileIds.push(String(ordinaryProfile.id));
  const { error: assignmentError } = await admin.from("user_roles").insert({
    user_id: ordinaryProfile.id,
    role_id: commonRole.id
  });
  if (assignmentError) throw new Error("Could not assign the ordinary account fixture role");

  const promotionAttempt = await admin.rpc("bootstrap_first_admin_profile", {
    p_auth_user_id: ordinaryAuth.id,
    p_login_name: identities[2].loginName,
    p_display_name: identities[2].displayName,
    p_email: identities[2].email
  });
  assert.equal(promotionAttempt.error?.code, "23505", "an existing ordinary account cannot be upgraded by bootstrap");

  const { data: marked, error: markError } = await admin.rpc(
    "mark_password_reset_requested",
    { p_auth_user_id: winnerAuth.id }
  );
  if (markError || marked !== true) throw new Error("The bootstrapped admin could not enter forced password setup");
  const { data: preservedProfile, error: preserveError } = await admin
    .from("profiles")
    .select("id,must_reset_password,password_reset_requested_at")
    .eq("id", bootstrap.id)
    .single();
  if (preserveError) throw new Error("Could not verify the protected administrator reset state");
  assert.equal(preservedProfile.must_reset_password, true, "password setup must remain required");
  assert.ok(preservedProfile.password_reset_requested_at, "the marked reset request remains available for email delivery");

  const delivery = await admin.auth.resetPasswordForEmail(winnerIdentity.email, {
    redirectTo: "http://127.0.0.1:8848/#/reset-password"
  });
  if (delivery.error) throw new Error("Initial administrator password email could not be delivered");
  const captured = await fetch(`${mailpitUrl}/api/v1/messages?start=0&limit=100`);
  if (!captured.ok) throw new Error("Local Mailpit is not available");
  const mails = await captured.json();
  if (!(mails.messages ?? []).some(mail =>
    mail.To?.some(recipient => recipient.Address?.toLowerCase() === winnerIdentity.email.toLowerCase())
  )) throw new Error("Initial administrator password email was not captured by Mailpit");

  console.log(JSON.stringify({
    initialAdminConcurrency: "one winner",
    identicalInitialization: "idempotent",
    ordinaryAccountPromotion: "rejected",
    passwordSetupState: "profile protected and reset email captured by Mailpit"
  }));
} finally {
  await cleanup();
  admin.realtime.disconnect();
}
