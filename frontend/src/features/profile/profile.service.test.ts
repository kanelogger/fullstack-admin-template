import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn()
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => ({ rpc: mocks.rpc })
}));

import { AuthSessionRejectedError } from "@/features/auth/session-errors";
import { getCurrentSession, ProfileServiceError } from "./profile.service";
import { isTransientAuthSessionError } from "@/features/auth/session-errors";

describe("current profile Auth errors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves an explicit JWT rejection as an Auth session rejection with the source error", async () => {
    const sourceError = Object.assign(new Error("JWT rejected"), { code: "PGRST301" });
    mocks.rpc.mockResolvedValue({ data: null, error: sourceError });

    await expect(getCurrentSession()).rejects.toMatchObject({
      name: "AuthSessionRejectedError",
      cause: sourceError
    });
  });

  it("keeps non-auth PostgREST errors intact for transient handling and diagnostics", async () => {
    const sourceError = Object.assign(new Error("upstream unavailable"), {
      code: "PGRST000",
      details: "gateway unavailable"
    });
    mocks.rpc.mockResolvedValue({ data: null, error: sourceError });

    await expect(getCurrentSession()).rejects.toMatchObject({
      code: "PGRST000",
      cause: sourceError
    });
  });

  it("preserves the PostgREST transport status when fetch fails", async () => {
    const sourceError = Object.assign(new Error("Failed to fetch"), { code: "" });
    mocks.rpc.mockResolvedValue({ data: null, error: sourceError, status: 0, statusText: "" });

    let caught: unknown;
    try {
      await getCurrentSession();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProfileServiceError);
    expect(caught).toMatchObject({ code: "", status: 0, cause: sourceError });
    expect(isTransientAuthSessionError(caught)).toBe(true);
  });

  it("treats a missing active profile as a rejected application Session", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await expect(getCurrentSession()).rejects.toBeInstanceOf(AuthSessionRejectedError);
  });
});
