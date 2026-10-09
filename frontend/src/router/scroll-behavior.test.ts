import { describe, expect, it, vi } from "vitest";
import { resolveScrollPosition } from "./scroll-behavior";

describe("resolveScrollPosition", () => {
  it("returns the history position for back and forward navigation", () => {
    const readScrollTop = vi.fn(() => 80);
    expect(resolveScrollPosition(true, { left: 4, top: 120 }, readScrollTop)).toEqual({
      left: 4,
      top: 120
    });
    expect(readScrollTop).not.toHaveBeenCalled();
  });

  it("keeps the current scroll when the source route asks to save it", () => {
    const readScrollTop = vi.fn(() => 240);
    expect(resolveScrollPosition(true, null, readScrollTop)).toEqual({
      left: 0,
      top: 240
    });
  });

  it("settles without moving the window when no position was saved", () => {
    const readScrollTop = vi.fn(() => 240);
    const position = resolveScrollPosition(false, null, readScrollTop);
    expect(position).toBe(false);
    expect(position).not.toBeInstanceOf(Promise);
    expect(readScrollTop).not.toHaveBeenCalled();
  });
});
