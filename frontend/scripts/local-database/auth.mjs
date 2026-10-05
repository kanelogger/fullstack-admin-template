import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { delay, fixtureUsers, mailpitUrl, startEdgeFunctions, tokenAuthMethods, tokenHasAuthMethod } from "./shared.mjs";
import { testPasswordLoginMethod } from "./messages.mjs";
import { testManagedUserAdministration } from "./user-management.mjs";

export async function testForcedResetEmail(url, publishableKey, admin) {
  const resetFixture = fixtureUsers.find(user => user.mustResetPassword);
  if (!resetFixture) throw new Error("Forced-reset fixture is missing");

  const edgeServer = await startEdgeFunctions(url, publishableKey);
  const capturedMessageIds = [];
  try {
    const response = await fetch(`${url}/functions/v1/password-reset`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
        Origin: "http://localhost:8848"
      },
      body: JSON.stringify({ loginName: resetFixture.loginName })
    });
    const body = await response.json().catch(() => null);
    if (response.status !== 200 || body?.success !== true) {
      throw new Error(
        `Password-reset request returned HTTP ${response.status} code ${body?.error?.code ?? "unknown"}`
      );
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const mailpitResponse = await fetch(
        `${mailpitUrl}/api/v1/messages?start=0&limit=50`
      );
      if (mailpitResponse.ok) {
        const mailbox = await mailpitResponse.json();
        for (const message of mailbox.messages ?? []) {
          if (
            message.To?.some(recipient =>
              recipient.Address?.toLowerCase() === resetFixture.email.toLowerCase()
            ) && message.ID
          ) {
            capturedMessageIds.push(message.ID);
          }
        }
        if (capturedMessageIds.length) {
          break;
        }
      }
      await delay(500);
    }

    if (!capturedMessageIds.length) {
      throw new Error("Local Mailpit did not capture the forced-reset message");
    }

    await testPasswordRecoveryMethod(url, publishableKey, admin, resetFixture);
    await testManagedUserAdministration(url, publishableKey, admin);
    await testPasswordLoginMethod(url, publishableKey, admin);
    console.log(`Forced-reset email captured by local Mailpit (${capturedMessageIds.length})`);
  } finally {
    if (capturedMessageIds.length) {
      await fetch(`${mailpitUrl}/api/v1/messages`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IDs: capturedMessageIds })
      });
    }
    edgeServer.kill("SIGINT");
    await new Promise(resolveExit => {
      if (edgeServer.exitCode !== null) return resolveExit();
      edgeServer.once("exit", () => resolveExit());
    });
  }
}


export async function testPasswordRecoveryMethod(url, publishableKey, admin, fixture) {
  const { data: generated, error: generateError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: fixture.email,
    options: { redirectTo: "http://127.0.0.1:8848/#/reset-password" }
  });
  const tokenHash = generated?.properties?.hashed_token;
  if (generateError || typeof tokenHash !== "string") {
    throw new Error("Could not generate a local password-recovery verification token");
  }

  const recoveryClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const nextPassword = `${randomUUID()}Bb2#`;
  try {
    const { data: verified, error: verifyError } = await recoveryClient.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery"
    });
    if (verifyError) {
      throw new Error(`Recovery token verification failed (${verifyError.code ?? "unknown"})`);
    }
    if (!verified.session) {
      throw new Error("Recovery token verification returned no session");
    }
    const recoveryMethods = tokenAuthMethods(verified.session.access_token);
    if (!recoveryMethods.some(method => method === "recovery" || method === "otp")) {
      throw new Error(`Recovery session methods were ${recoveryMethods.join(",") || "empty"}`);
    }

    const { data: profileResetState, error: resetStateError } = await admin
      .from("profiles")
      .select("password_reset_requested_at")
      .eq("id", fixture.id)
      .single();
    if (resetStateError || !profileResetState?.password_reset_requested_at) {
      throw new Error("The server did not record the password-reset request");
    }

    const { data: prematureCompletion, error: prematureError } = await recoveryClient.rpc(
      "complete_password_reset"
    );
    if (prematureError || prematureCompletion !== false) {
      throw new Error("Recovery session cleared the marker without changing the Auth password");
    }

    const { error: passwordError } = await recoveryClient.auth.updateUser({
      password: nextPassword
    });
    if (passwordError) throw new Error("Could not set a password through the recovery session");

    const { data: completed, error: completeError } = await recoveryClient.rpc(
      "complete_password_reset"
    );
    if (completeError || completed !== true) {
      throw new Error("Recovery session could not complete its scoped password-reset RPC");
    }
    const { data: completedProfile, error: completedProfileError } = await admin
      .from("profiles")
      .select("must_reset_password, password_reset_requested_at")
      .eq("id", fixture.id)
      .single();
    if (
      completedProfileError ||
      completedProfile.must_reset_password !== false ||
      completedProfile.password_reset_requested_at !== null
    ) {
      throw new Error("Password reset completion did not consume its server-side reset state");
    }
    const { data: recoveryProfile, error: profileError } = await recoveryClient.rpc(
      "current_profile"
    );
    if (profileError || recoveryProfile !== null) {
      throw new Error("Recovery session was incorrectly granted business profile access");
    }
    const { data: recoveryBusinessUserId, error: idError } = await recoveryClient.rpc(
      "current_business_user_id"
    );
    if (idError || recoveryBusinessUserId !== null) {
      throw new Error("Recovery session was incorrectly granted an application token identity");
    }
  } finally {
    await recoveryClient.auth.signOut({ scope: "local" });
  }

  const passwordClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  try {
    const { data: signedIn, error: signInError } = await passwordClient.auth.signInWithPassword({
      email: fixture.email,
      password: nextPassword
    });
    if (
      signInError ||
      !signedIn.session ||
      !tokenHasAuthMethod(signedIn.session.access_token, "password")
    ) {
      throw new Error("The reset password could not be used for password sign-in");
    }
    const { data: profile, error: profileError } = await passwordClient.rpc("current_profile");
    if (profileError || profile !== null) {
      throw new Error("Direct email/password Auth session bypassed account-login authorization");
    }
    const { data: directBusinessUserId, error: directIdError } = await passwordClient.rpc(
      "current_business_user_id"
    );
    if (directIdError || directBusinessUserId !== null) {
      throw new Error("Direct email/password Auth session obtained an application user ID");
    }
  } finally {
    await passwordClient.auth.signOut({ scope: "local" });
  }

  const loginResponse = await fetch(`${url}/functions/v1/session-login`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
      Origin: "http://localhost:8848"
    },
    body: JSON.stringify({ loginName: fixture.loginName, password: nextPassword })
  });
  const loginBody = await loginResponse.json().catch(() => null);
  if (loginResponse.status !== 200 || loginBody?.success !== true) {
    throw new Error("Account/password login did not accept the recovered password");
  }

  const accountClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  try {
    const { error: sessionError } = await accountClient.auth.setSession({
      access_token: loginBody.data.tokens.accessToken,
      refresh_token: loginBody.data.tokens.refreshToken
    });
    if (sessionError) throw new Error("Could not initialize the account/password session");
    const { data: profile, error: profileError } = await accountClient.rpc("current_profile");
    if (profileError || profile?.loginName !== fixture.loginName) {
      throw new Error("Account/password login could not read its own profile after recovery");
    }
  } finally {
    try {
      await accountClient.rpc("revoke_account_password_session");
    } catch {
      // Sign out locally even when revocation cannot reach the test database.
    }
    await accountClient.auth.signOut({ scope: "local" });
  }
}
