import { randomUUID } from "node:crypto";
import { fixtureUsers, invokeUserManagement, loginFixtureWithAccountPassword, mailpitMessagesFor, mailpitUrl, organizationFixtureCodes, waitForMailpitMessages } from "./shared.mjs";

export async function testManagedUserAdministration(url, publishableKey, admin) {
  const superAdmin = fixtureUsers.find(user => user.roleCode === "SUPER_ADMIN");
  const operator = fixtureUsers.find(user => user.roleCode === "OPERATOR");
  const commonUser = fixtureUsers.find(user => user.roleCode === "COMMON_USER");
  if (!superAdmin || !operator || !commonUser) {
    throw new Error("User-management role fixtures are missing");
  }

  const loginSuffix = randomUUID().replace(/-/g, "").slice(0, 16);
  const managedLoginName = `__codex_managed_${loginSuffix}`;
  const managedEmail = `__codex_managed_${loginSuffix}@example.test`;
  const managedUserCode = `__CODEX_${loginSuffix.toUpperCase()}`;
  let authUserId;
  let capturedMessageIds = [];

  try {
    const superAccessToken = await loginFixtureWithAccountPassword(
      url,
      publishableKey,
      superAdmin
    );
    const roleOptionsResult = await invokeUserManagement(
      url,
      publishableKey,
      superAccessToken,
      { action: "roles" }
    );
    const commonRole = roleOptionsResult.body?.data?.find(role => role.code === "COMMON_USER");
    if (
      roleOptionsResult.response.status !== 200 ||
      typeof commonRole?.id !== "string"
    ) {
      throw new Error("SUPER_ADMIN could not load role options for user creation");
    }

    const createdResult = await invokeUserManagement(url, publishableKey, superAccessToken, {
      action: "create",
      input: {
        userCode: managedUserCode,
        loginName: managedLoginName,
        displayName: "Disposable managed user",
        email: managedEmail,
        phone: null,
        departmentId: null,
        postId: null,
        roleIds: [commonRole.id]
      }
    });
    const createdUser = createdResult.body?.data?.user;
    if (
      createdResult.response.status !== 200 ||
      createdResult.body?.success !== true ||
      createdUser?.loginName !== managedLoginName ||
      createdUser?.roles?.[0]?.code !== "COMMON_USER" ||
      createdUser?.isActive !== true
    ) {
      throw new Error("SUPER_ADMIN could not create a managed Auth/profile/role account");
    }
    authUserId = (await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }))
      .data?.users?.find(user => user.email?.toLowerCase() === managedEmail.toLowerCase())?.id;
    if (!authUserId) throw new Error("The created managed Auth user could not be found");
    capturedMessageIds = (await waitForMailpitMessages(managedEmail, 1)).map(mail => mail.ID);

    const { data: departmentOptions, error: departmentOptionsError } = await admin
      .from("department_read_model")
      .select("id")
      .eq("dept_code", organizationFixtureCodes.department)
      .eq("status", 1)
      .limit(1);
    const { data: postOptions, error: postOptionsError } = await admin
      .from("post_read_model")
      .select("id")
      .eq("post_code", organizationFixtureCodes.post)
      .eq("status", 1)
      .limit(1);
    const departmentId = departmentOptions?.[0]?.id;
    const postId = postOptions?.[0]?.id;
    if (
      departmentOptionsError || postOptionsError ||
      typeof departmentId !== "string" || typeof postId !== "string"
    ) {
      throw new Error("The disposable department/post options could not be read as exact text IDs");
    }
    const updatedResult = await invokeUserManagement(url, publishableKey, superAccessToken, {
      action: "update",
      input: {
        id: createdUser.id,
        userCode: `${managedUserCode}_EDIT`,
        loginName: managedLoginName,
        displayName: "Updated managed user",
        phone: "555-0100",
        departmentId,
        postId,
        roleIds: [commonRole.id]
      }
    });
    if (
      updatedResult.response.status !== 200 ||
      updatedResult.body?.data?.user?.departmentId !== departmentId ||
      updatedResult.body?.data?.user?.postId !== postId ||
      updatedResult.body?.data?.user?.displayName !== "Updated managed user"
    ) {
      throw new Error("User update did not preserve profile fields and BIGINT relation IDs");
    }

    const filteredResult = await invokeUserManagement(url, publishableKey, superAccessToken, {
      action: "list",
      query: { loginName: managedLoginName, departmentId, postId, page: 1, pageSize: 10 }
    });
    if (
      filteredResult.response.status !== 200 ||
      filteredResult.body?.data?.total !== 1 ||
      filteredResult.body?.data?.items?.[0]?.id !== createdUser.id
    ) {
      throw new Error("User list filters did not match the created profile");
    }

    const disabledResult = await invokeUserManagement(url, publishableKey, superAccessToken, {
      action: "status",
      id: createdUser.id,
      isActive: false
    });
    if (disabledResult.response.status !== 200 || disabledResult.body?.data?.user?.isActive !== false) {
      throw new Error("User status update did not disable the account");
    }

    const enabledResult = await invokeUserManagement(url, publishableKey, superAccessToken, {
      action: "status",
      id: createdUser.id,
      isActive: true
    });
    if (enabledResult.response.status !== 200 || enabledResult.body?.data?.user?.isActive !== true) {
      throw new Error("User status update did not enable the account");
    }

    const { data: commonProfile, error: commonProfileError } = await admin
      .from("profiles")
      .select("id")
      .eq("login_name", commonUser.loginName)
      .single();
    if (commonProfileError || !commonProfile) {
      throw new Error("Could not find the reset-password permission fixture");
    }
    const resetResult = await invokeUserManagement(url, publishableKey, superAccessToken, {
      action: "reset-password",
      id: String(commonProfile.id)
    });
    if (resetResult.response.status !== 200 || resetResult.body?.success !== true) {
      throw new Error("SUPER_ADMIN could not request a managed user's password reset");
    }
    const resetFixtureMessages = await waitForMailpitMessages(commonUser.email, 1);
    capturedMessageIds = [
      ...capturedMessageIds,
      ...resetFixtureMessages.map(mail => mail.ID)
    ];

    const operatorAccessToken = await loginFixtureWithAccountPassword(
      url,
      publishableKey,
      operator
    );
    const deniedList = await invokeUserManagement(url, publishableKey, operatorAccessToken, {
      action: "list",
      query: { page: 1, pageSize: 10 }
    });
    if (deniedList.response.status !== 403) {
      throw new Error("OPERATOR without user-read permission accessed managed users");
    }

    const deletedResult = await invokeUserManagement(url, publishableKey, superAccessToken, {
      action: "delete",
      id: createdUser.id
    });
    if (deletedResult.response.status !== 200 || deletedResult.body?.data?.deleted !== true) {
      throw new Error("Managed user soft-delete failed");
    }
    const deletedList = await invokeUserManagement(url, publishableKey, superAccessToken, {
      action: "list",
      query: { loginName: managedLoginName, page: 1, pageSize: 10 }
    });
    if (deletedList.response.status !== 200 || deletedList.body?.data?.total !== 0) {
      throw new Error("Soft-deleted user remained visible in the managed-user list");
    }

    const { data: createAudit, error: createAuditError } = await admin
      .from("operation_logs")
      .select("operator_id, module_code, operation_type, request_path, request_params")
      .eq("operator_id", superAdmin.id)
      .eq("module_code", "USER")
      .eq("operation_type", "CREATE")
      .eq("request_path", "/functions/v1/user-management")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      createAuditError ||
      createAudit?.request_params?.targetUserId !== createdUser.id ||
      JSON.stringify(createAudit?.request_params ?? {}).includes("password")
    ) {
      throw new Error("Managed-user mutations were not safely recorded in Supabase operation logs");
    }
    console.log("Managed user create/update/status/reset/delete and permission checks passed");
  } finally {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, auth_user_id")
      .eq("login_name", managedLoginName);
    if (profiles?.length) {
      await admin.from("profiles").delete().in("id", profiles.map(profile => profile.id));
      authUserId ??= profiles[0].auth_user_id;
    }
    if (!authUserId) {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      authUserId = data.users.find(
        user => user.email?.toLowerCase() === managedEmail.toLowerCase()
      )?.id;
    }
    if (authUserId) await admin.auth.admin.deleteUser(authUserId);
    capturedMessageIds = [
      ...new Set([
        ...capturedMessageIds,
        ...(await mailpitMessagesFor(managedEmail)).map(mail => mail.ID),
        ...(await mailpitMessagesFor(commonUser.email)).map(mail => mail.ID)
      ])
    ];
    if (capturedMessageIds.length) {
      await fetch(`${mailpitUrl}/api/v1/messages`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IDs: capturedMessageIds })
      });
    }
  }
}

