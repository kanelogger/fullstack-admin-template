import { beforeEach, describe, expect, it } from "vitest";
import {
  beginAuthOperation,
  invalidateAuthOperations,
  isCurrentAuthOperation
} from "./session-generation";

describe("auth operation revisions", () => {
  beforeEach(() => {
    invalidateAuthOperations();
  });

  it("rejects an older login result after another login starts", () => {
    const firstLogin = beginAuthOperation();
    const secondLogin = beginAuthOperation();

    expect(isCurrentAuthOperation(firstLogin)).toBe(false);
    expect(isCurrentAuthOperation(secondLogin)).toBe(true);
  });

  it("rejects a pending login result after logout", () => {
    const login = beginAuthOperation();
    invalidateAuthOperations();

    expect(isCurrentAuthOperation(login)).toBe(false);
  });
});
