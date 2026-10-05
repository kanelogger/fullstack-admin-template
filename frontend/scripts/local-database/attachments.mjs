/* eslint-disable no-unsafe-finally -- Cleanup failures must fail isolated Storage acceptance. */
import { randomUUID } from "node:crypto";
import { createAccountPasswordClient, fixtureUsers, startEdgeFunctions } from "./shared.mjs";

export async function testAttachmentStorageAccess(url, publishableKey, admin) {
  const superAdmin = fixtureUsers.find(user => user.roleCode === "SUPER_ADMIN");
  const operator = fixtureUsers.find(user => user.roleCode === "OPERATOR");
  const commonUser = fixtureUsers.find(user => user.roleCode === "COMMON_USER");
  if (!superAdmin || !operator || !commonUser) {
    throw new Error("Attachment role fixtures are missing");
  }

  const edgeServer = await startEdgeFunctions(url, publishableKey);
  const clients = [];
  let storagePath = null;
  let attachmentId = null;
  const metadataIds = new Set();
  try {
    const owner = await createAccountPasswordClient(url, publishableKey, superAdmin);
    clients.push(owner);
    const { data: successfulLoginAudit, error: successfulLoginAuditError } = await admin
      .from("login_logs")
      .select("user_id, login_result, failure_reason")
      .eq("login_name", superAdmin.loginName)
      .eq("user_id", superAdmin.id)
      .eq("login_result", 1)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (successfulLoginAuditError || successfulLoginAudit?.login_result !== 1) {
      throw new Error("Successful account/password login was not recorded in Supabase login logs");
    }

    const failedLoginResponse = await fetch(`${url}/functions/v1/session-login`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
        Origin: "http://localhost:8848"
      },
      body: JSON.stringify({ loginName: superAdmin.loginName, password: "not-the-fixture-password" })
    });
    if (failedLoginResponse.status !== 401) {
      throw new Error("Invalid account/password login was unexpectedly accepted");
    }
    const { data: failedLoginAudit, error: failedLoginAuditError } = await admin
      .from("login_logs")
      .select("login_result, failure_reason")
      .eq("login_name", superAdmin.loginName)
      .eq("login_result", 0)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      failedLoginAuditError ||
      failedLoginAudit?.login_result !== 0 ||
      failedLoginAudit?.failure_reason !== "INVALID_CREDENTIALS"
    ) {
      throw new Error("Invalid account/password attempt was not recorded safely");
    }

    const bytes = Buffer.from("private attachment RLS check", "utf8");
    storagePath = `${superAdmin.id}/${randomUUID()}.txt`;
    const { error: uploadError } = await owner.storage
      .from("admin-attachments")
      .upload(storagePath, new Blob([bytes], { type: "text/plain" }), {
        contentType: "text/plain",
        upsert: false
      });
    if (uploadError) throw new Error("SUPER_ADMIN could not upload to private Storage");

    const { data: created, error: metadataError } = await owner.rpc(
      "create_attachment_metadata",
      {
        p_original_name: "__codex_private_attachment.txt",
        p_storage_path: storagePath,
        p_mime_type: "text/plain",
        p_file_ext: "txt",
        p_file_size: bytes.length,
        p_business_module: null,
        p_business_record_id: null
      }
    );
    if (metadataError || !created?.id) {
      throw new Error("SUPER_ADMIN could not create metadata for a private object");
    }
    attachmentId = String(created.id);

    const { data: ownerMetadata, error: ownerReadError } = await owner
      .from("attachment_read_model")
      .select("id")
      .eq("id", attachmentId)
      .single();
    if (ownerReadError || ownerMetadata?.id !== attachmentId) {
      throw new Error(`SUPER_ADMIN could not read the new attachment metadata (${ownerReadError?.code ?? "id-mismatch"})`);
    }

    const operatorClient = await createAccountPasswordClient(url, publishableKey, operator);
    clients.push(operatorClient);
    const { data: operatorMetadata, error: operatorReadError } = await operatorClient
      .from("attachment_read_model")
      .select("id")
      .eq("id", attachmentId)
      .single();
    if (operatorReadError || operatorMetadata?.id !== attachmentId) {
      throw new Error("OPERATOR could not read an authorized attachment");
    }
    const { data: operatorFile, error: operatorDownloadError } = await operatorClient
      .storage.from("admin-attachments").download(storagePath);
    if (operatorDownloadError || !operatorFile || Buffer.from(await operatorFile.arrayBuffer()).compare(bytes) !== 0) {
      throw new Error("OPERATOR could not read the authorized private object");
    }

    const operatorUploadPath = `${operator.id}/${randomUUID()}.txt`;
    const { error: deniedUploadError } = await operatorClient.storage
      .from("admin-attachments")
      .upload(operatorUploadPath, new Blob([bytes], { type: "text/plain" }), {
        contentType: "text/plain",
        upsert: false
      });
    if (!deniedUploadError) throw new Error("OPERATOR uploaded without the upload permission");

    const { data: deniedDeleteData, error: deniedDeleteError } = await operatorClient.storage
      .from("admin-attachments")
      .remove([storagePath]);
    if (!deniedDeleteError && (deniedDeleteData?.length ?? 0) > 0) {
      throw new Error("OPERATOR deleted an attachment without the delete permission");
    }
    const { data: stillReadable, error: stillReadableError } = await operatorClient.storage
      .from("admin-attachments").download(storagePath);
    if (stillReadableError || !stillReadable) {
      throw new Error("A denied OPERATOR delete removed the private object");
    }

    const commonClient = await createAccountPasswordClient(url, publishableKey, commonUser);
    clients.push(commonClient);
    const { data: commonMetadata, error: commonReadError } = await commonClient
      .from("attachment_read_model")
      .select("id")
      .eq("id", attachmentId);
    if (commonReadError || commonMetadata?.length !== 0) {
      throw new Error("COMMON_USER read an attachment outside its allowed module scope");
    }
    const { data: commonFile, error: commonDownloadError } = await commonClient
      .storage.from("admin-attachments").download(storagePath);
    if (!commonDownloadError || commonFile) {
      throw new Error("COMMON_USER downloaded an attachment without module permission");
    }

    const { data: deletePath, error: pathError } = await owner.rpc(
      "attachment_storage_path_for_delete",
      { p_attachment_id: attachmentId }
    );
    if (pathError || deletePath !== storagePath) {
      throw new Error("SUPER_ADMIN could not resolve the private object for deletion");
    }
    const { error: removeError } = await owner.storage
      .from("admin-attachments").remove([storagePath]);
    if (removeError) throw new Error("SUPER_ADMIN could not delete the private object");
    const { data: deleted, error: deleteError } = await owner.rpc(
      "delete_attachment_metadata",
      { p_attachment_id: attachmentId }
    );
    if (deleteError || deleted !== true) {
      throw new Error("SUPER_ADMIN could not soft-delete attachment metadata");
    }

    console.log("Private Storage role checks passed");
  } finally {
    const paths = [storagePath].filter(Boolean);
    if (paths.length) {
      await admin.storage.from("admin-attachments").remove(paths);
    }
    if (attachmentId) metadataIds.add(attachmentId);
    if (metadataIds.size) {
      const { error } = await admin.from("attachments").delete().in("id", [...metadataIds]);
      if (error) throw new Error("Could not clean the local attachment metadata fixture");
    }
    await Promise.all(clients.map(async client => {
      try {
        await client.rpc("revoke_account_password_session");
      } finally {
        await client.auth.signOut({ scope: "local" });
      }
    }));
    edgeServer.kill("SIGINT");
    await new Promise(resolveExit => {
      if (edgeServer.exitCode !== null) return resolveExit();
      edgeServer.once("exit", () => resolveExit());
    });
  }
}
