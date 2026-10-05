import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { delay, fixtureUsers, tokenHasAuthMethod } from "./shared.mjs";

export async function testPasswordLoginMethod(url, publishableKey, admin) {
  const fixture = fixtureUsers.find(user => user.roleCode === "COMMON_USER");
  if (!fixture?.password) throw new Error("Password login fixture is missing");

  const response = await fetch(`${url}/functions/v1/session-login`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
      Origin: "http://localhost:8848"
    },
    body: JSON.stringify({ loginName: fixture.loginName, password: fixture.password })
  });
  const body = await response.json().catch(() => null);
  const tokens = body?.data?.tokens;
  if (
    response.status !== 200 ||
    body?.success !== true ||
    typeof tokens?.accessToken !== "string" ||
    typeof tokens?.refreshToken !== "string" ||
    !tokenHasAuthMethod(tokens.accessToken, "password")
  ) {
    throw new Error("Account/password login did not produce a password-authenticated session");
  }

  const client = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  try {
    const { error: sessionError } = await client.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken
    });
    if (sessionError) throw new Error("Could not initialize the local password session");

    const { data: profile, error: profileError } = await client.rpc("current_profile");
    if (profileError || profile?.loginName !== fixture.loginName) {
      throw new Error("Password-authenticated session could not read its own profile");
    }
    const { data: businessUserId, error: idError } = await client.rpc(
      "current_business_user_id"
    );
    if (idError || businessUserId !== fixture.id) {
      throw new Error("Password-authenticated session could not resolve its own business ID");
    }

    const { data: messages, error: listError, count: listCount } = await client
      .from("message_read_model")
      .select("id, receiver_id, title, summary, message_type, read_status, sent_at, read_at", {
        count: "exact"
      })
      .eq("receiver_id", fixture.id)
      .order("sent_at", { ascending: false })
      .order("id", { ascending: false })
      .range(0, 9);
    if (
      listError ||
      listCount !== 1 ||
      messages?.length !== 1 ||
      typeof messages[0].id !== "string" ||
      messages[0].read_status !== false
    ) {
      throw new Error("Recipient message list did not return its BIGINT-string inbox row");
    }

    const { count: unreadBefore, error: unreadError } = await client
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("receiver_id", fixture.id)
      .eq("read_status", false)
      .eq("deleted", false);
    if (unreadError || unreadBefore !== 1) {
      throw new Error("Recipient unread-message count did not match its inbox");
    }

    const { error: readError } = await client
      .from("messages")
      .update({ read_status: true, read_at: new Date().toISOString() })
      .eq("id", messages[0].id)
      .eq("receiver_id", fixture.id);
    if (readError) throw new Error("Recipient could not mark an inbox message as read");

    const { data: messageDetail, error: detailError } = await client
      .from("message_read_model")
      .select("id, receiver_id, sender_id, title, summary, content, message_type, read_status, sent_at, read_at")
      .eq("id", messages[0].id)
      .eq("receiver_id", fixture.id)
      .single();
    if (detailError || messageDetail?.read_status !== true) {
      throw new Error("Recipient could not read the updated inbox detail");
    }
    const { count: unreadAfter, error: unreadAfterError } = await client
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("receiver_id", fixture.id)
      .eq("read_status", false)
      .eq("deleted", false);
    if (unreadAfterError || unreadAfter !== 0) {
      throw new Error("Marking a message read did not update the unread count");
    }

    await testMessageRealtime(client, admin, fixture);
  } finally {
    await client.auth.signOut({ scope: "local" });
    await client.realtime.disconnect();
  }
}


async function waitUntil(predicate, failureMessage, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(100);
  }
  throw new Error(typeof failureMessage === "function" ? failureMessage() : failureMessage);
}


async function testMessageRealtime(client, admin, fixture) {
  const title = `__codex_realtime_${randomUUID()}`;
  const otherTitle = `__codex_realtime_other_${randomUUID()}`;
  const otherRecipient = fixtureUsers.find(user => user.roleCode === "OPERATOR");
  if (!otherRecipient) throw new Error("Other-recipient Realtime fixture is missing");
  const observed = [];
  let subscriptionStatus = "CONNECTING";
  let subscriptionError;
  let replicationReady = false;
  let replicationError;
  const channel = client
    .channel(`test-inbox:${fixture.id}:${randomUUID()}`, {
      config: {
        broadcast: { replication_ready: true },
        postgres_changes_options: { wait: true }
      }
    })
    .on("system", {}, payload => {
      if (payload.extension !== "system") return;
      if (payload.status === "ok") replicationReady = true;
      else if (payload.status === "error") replicationError = payload.message;
    })
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages"
      },
      payload => observed.push({ event: "INSERT", payload })
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "messages"
      },
      payload => observed.push({ event: "UPDATE", payload })
    )
    .subscribe((status, error) => {
      subscriptionStatus = status;
      subscriptionError = error;
    });

  const messageIds = [];
  try {
    await waitUntil(
      () => (subscriptionStatus === "SUBSCRIBED" && replicationReady) || Boolean(subscriptionError || replicationError),
      "Realtime message subscription did not become ready"
    );
    if (subscriptionError || replicationError || subscriptionStatus !== "SUBSCRIBED" || !replicationReady) {
      throw new Error(
        `Could not subscribe to the recipient's message changes (status=${subscriptionStatus}, replicationReady=${replicationReady}, detail=${subscriptionError?.message ?? replicationError ?? "none"})`
      );
    }
    const { data: inserted, error: insertError } = await admin
      .from("messages")
      .insert({
        receiver_id: fixture.id,
        title,
        summary: "Realtime insert test",
        content: "A message should be delivered only to this recipient.",
        message_type: "NOTICE"
      })
      .select("title")
      .single();
    if (insertError || !inserted) throw new Error("Could not create a realtime message fixture");
    const { data: insertedReadModel, error: insertedReadModelError } = await admin
      .from("message_read_model")
      .select("id")
      .eq("receiver_id", fixture.id)
      .eq("title", title)
      .single();
    if (insertedReadModelError || !insertedReadModel) {
      throw new Error("Could not read the BIGINT-string Realtime fixture ID");
    }
    messageIds.push(insertedReadModel.id);

    await waitUntil(
      () => observed.some(item => item.event === "INSERT" && item.payload.new?.title === title),
      `Recipient did not receive the new-message Realtime event (status=${subscriptionStatus}, events=${observed.map(item => item.event).join(",") || "none"})`
    );

    const { data: otherInserted, error: otherInsertError } = await admin
      .from("messages")
      .insert({
        receiver_id: otherRecipient.id,
        title: otherTitle,
        summary: "Recipient isolation test",
        content: "This message belongs to a different user.",
        message_type: "NOTICE"
      })
      .select("title")
      .single();
    if (otherInsertError || !otherInserted) {
      throw new Error("Could not create a cross-recipient Realtime fixture");
    }
    const { data: otherReadModel, error: otherReadModelError } = await admin
      .from("message_read_model")
      .select("id")
      .eq("receiver_id", otherRecipient.id)
      .eq("title", otherTitle)
      .single();
    if (otherReadModelError || !otherReadModel) {
      throw new Error("Could not read the cross-recipient fixture ID");
    }
    messageIds.push(otherReadModel.id);
    await delay(1000);
    if (observed.some(item => item.payload.new?.title === otherTitle)) {
      throw new Error("Realtime delivered another recipient's message");
    }

    const { error: updateError } = await client
      .from("messages")
      .update({ read_status: true, read_at: new Date().toISOString() })
      .eq("id", messageIds[0])
      .eq("receiver_id", fixture.id);
    if (updateError) throw new Error("Recipient could not update its message read state");

    await waitUntil(
      () => observed.some(item =>
        item.event === "UPDATE" &&
        item.payload.new?.title === title &&
        item.payload.new?.read_status === true
      ),
      () => `Recipient did not receive the message read-state Realtime event (status=${subscriptionStatus}, events=${JSON.stringify(
        observed.map(item => ({
          event: item.event,
          id: String(item.payload.new?.id ?? ""),
          title: item.payload.new?.title,
          readStatus: item.payload.new?.read_status
        }))
      )})`
    );
  } finally {
    if (messageIds.length) {
      await admin.from("messages").delete().in("id", messageIds);
    }
    await client.removeChannel(channel);
  }
}

