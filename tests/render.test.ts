import { describe, expect, it } from "vitest";
import { PALETTE } from "../src/net/protocol";
import { darken } from "../src/client/render";

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hue = ([r, g, b]: number[]) => {
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};
const lum = ([r, g, b]: number[]) => (Math.max(r, g, b) + Math.min(r, g, b)) / 2;

describe("darken (rear of the car)", () => {
  it("keeps the original red exactly as designed", () => {
    expect(darken("#e5412d")).toBe("#9c2417");
  });

  it("gives every palette color a darker shade of ITS OWN hue (not a dark red)", () => {
    for (const c of PALETTE) {
      const d = darken(c);
      expect(d).toMatch(/^#[0-9a-f]{6}$/);
      expect(lum(rgb(d))).toBeLessThan(lum(rgb(c)));
      const [hc, hd] = [hue(rgb(c)), hue(rgb(d))];
      const diff = Math.min(Math.abs(hc - hd), 360 - Math.abs(hc - hd));
      if (c !== "#f0f0f0" && c !== "#3a4250") expect(diff).toBeLessThan(8); // grays have no real hue
    }
  });

  it("the green stays green and the yellow stays yellow", () => {
    const [r, g, b] = rgb(darken("#45d483"));
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    const [r2, g2, b2] = rgb(darken("#ffd23d"));
    expect(r2).toBeGreaterThan(b2);
    expect(g2).toBeGreaterThan(b2);
  });
});
