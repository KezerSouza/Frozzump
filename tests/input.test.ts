import { describe, expect, it } from "vitest";
import { IN_LEFT, IN_RIGHT } from "../src/sim";
import { touchMask, touchSide } from "../src/client/input";

describe("touch steering", () => {
  it("left half of the screen steers left, right half steers right", () => {
    expect(touchSide(0, 800)).toBe(IN_LEFT);
    expect(touchSide(399, 800)).toBe(IN_LEFT);
    expect(touchSide(400, 800)).toBe(IN_RIGHT);
    expect(touchSide(799, 800)).toBe(IN_RIGHT);
  });

  it("combines every finger on the screen", () => {
    expect(touchMask([])).toBe(0);
    expect(touchMask([IN_LEFT])).toBe(IN_LEFT);
    expect(touchMask([IN_RIGHT, IN_RIGHT])).toBe(IN_RIGHT);
    expect(touchMask([IN_LEFT, IN_RIGHT])).toBe(IN_LEFT | IN_RIGHT);
  });
});
