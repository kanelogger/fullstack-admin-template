import type { Session } from "@supabase/supabase-js";

export type AuthSessionIdentity = {
  authUserId: string;
  sessionId: string;
  accessToken: string;
};

const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decode identity claims for stale-result checks; server authorization still verifies the JWT. */
export function getAuthSessionIdentity(
  session: (Pick<Session, "access_token"> & { user: { id: string } }) | null | undefined
): AuthSessionIdentity | null {
  if (!session?.access_token || !session.user.id) return null;
  const tokenParts = session.access_token.split(".");
  if (tokenParts.length !== 3) return null;
  try {
    const encodedPayload = tokenParts[1].replaceAll("-", "+").replaceAll("_", "/");
    const paddedPayload = encodedPayload.padEnd(Math.ceil(encodedPayload.length / 4) * 4, "=");
    const payloadBytes = Uint8Array.from(atob(paddedPayload), (character) =>
      character.charCodeAt(0)
    );
    const claims: unknown = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (typeof claims !== "object" || claims === null) return null;
    const record = claims as Record<string, unknown>;
    if (
      record.sub !== session.user.id ||
      typeof record.session_id !== "string" ||
      !sessionIdPattern.test(record.session_id)
    )
      return null;
    return {
      authUserId: session.user.id,
      sessionId: record.session_id,
      accessToken: session.access_token
    };
  } catch {
    return null;
  }
}

export function isSameAuthSession(
  left: Pick<AuthSessionIdentity, "authUserId" | "sessionId"> | null | undefined,
  right: Pick<AuthSessionIdentity, "authUserId" | "sessionId"> | null | undefined
): boolean {
  return Boolean(
    left && right && left.authUserId === right.authUserId && left.sessionId === right.sessionId
  );
}
