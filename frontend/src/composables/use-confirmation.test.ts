// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { confirmation, requestConfirmation } from "./use-confirmation";

afterEach(() => confirmation.cancel());
describe("pending action confirmation", () => {
  it("only authorizes the action after explicit confirmation", async () => {
    const pending = requestConfirmation("删除记录？");
    confirmation.cancel();
    await expect(pending).resolves.toBe(false);
    const accepted = requestConfirmation("启用记录？");
    confirmation.confirm();
    await expect(accepted).resolves.toBe(true);
  });
  it("cancels the previous caller rather than leaving its promise pending", async () => {
    const old = requestConfirmation("删除旧记录？");
    const current = requestConfirmation("删除新记录？");
    await expect(old).resolves.toBe(false);
    confirmation.confirm();
    await expect(current).resolves.toBe(true);
  });
});
