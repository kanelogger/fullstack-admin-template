import { afterEach, describe, expect, it } from "vitest";
import { withAuthSessionLock } from "./auth-session-lock";

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
});

describe("withAuthSessionLock", () => {
  it("serializes Auth mutations using one exclusive cross-tab lock", async () => {
    let queue = Promise.resolve();
    const requested: string[] = [];
    const locks = {
      request: async <T>(name: string, options: { mode: string }, callback: () => Promise<T>) => {
        expect(options.mode).toBe("exclusive");
        requested.push(name);
        const current = queue.then(callback);
        queue = current.then(
          () => undefined,
          () => undefined
        );
        return current;
      }
    };
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks } });

    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = withAuthSessionLock(async () => {
      order.push("first-start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push("first-end");
    });
    const second = withAuthSessionLock(async () => {
      order.push("second");
    });
    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(["first-start", "first-end", "second"]);
    expect(requested).toEqual([
      "fullstack-admin-template:supabase-auth-session",
      "fullstack-admin-template:supabase-auth-session"
    ]);
  });

  it("fails closed when the browser has no Web Locks API", async () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    await expect(withAuthSessionLock(async () => true)).rejects.toThrow(
      "does not support safe cross-tab"
    );
  });
});
