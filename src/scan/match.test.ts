import { describe, expect, it } from "vitest";
import { cardShaped, type Identified, judge, RULES } from "./match";
import type { Placement } from "./verify";

const GUIDE: Placement = [240, 330, 360, 0, 0, 503];
const sameName = (i: number, j: number) => Math.floor(i / 10) === Math.floor(j / 10);
const found = (scores: [number, number][], placement: Placement = GUIDE, sharpness = 1): Identified => ({
  candidates: scores.map(([index, score]) => ({ index, score })),
  placement,
  sharpness,
});

describe("verdikt skeneru", () => {
  it("jistá karta: vysoká shoda a odstup od karty jiného jména", () => {
    expect(judge(found([[1, 0.95], [25, 0.7]]), GUIDE, sameName)).toBe("sure");
    // dotisk stejného jména těsně za ní jistotu nebere
    expect(judge(found([[1, 0.95], [2, 0.94], [25, 0.7]]), GUIDE, sameName)).toBe("sure");
  });

  it("málo shody nebo malý odstup = nejisté, pod prahem = žádná karta", () => {
    expect(judge(found([[1, 0.78], [25, 0.5]]), GUIDE, sameName)).toBe("maybe");
    expect(judge(found([[1, 0.95], [25, 0.9]]), GUIDE, sameName)).toBe("maybe");
    expect(judge(found([[1, RULES.maybe - 0.01], [25, 0.3]]), GUIDE, sameName)).toBe("none");
  });

  it("místo, které nemá tvar karty v rámečku, není karta ani s vysokou shodou", () => {
    const strong: [number, number][] = [[1, 0.95], [25, 0.5]];
    const squashed: Placement = [240, 330, 360, 0, 0, 380]; // poměr stran 0,76
    const skewed: Placement = [240, 330, 360, 0, 120, 503]; // zkosení 0,23
    const small: Placement = [240, 330, 270, 0, 0, 377]; // velikost 0,75
    const away: Placement = [340, 330, 360, 0, 0, 503]; // střed posunutý o 0,28 šířky
    for (const p of [squashed, skewed, small, away]) {
      expect(cardShaped(found(strong, p), GUIDE)).toBe(false);
      expect(judge(found(strong, p), GUIDE, sameName)).toBe("none");
    }
    // mírně natočená a posunutá karta projde
    const c = Math.cos(0.08);
    const s = Math.sin(0.08);
    expect(judge(found(strong, [250, 340, 360 * c, 360 * s, -503 * s, 503 * c]), GUIDE, sameName)).toBe("sure");
  });

  it("rozmazaný záběr není karta", () => {
    expect(judge(found([[1, 0.9], [25, 0.5]], GUIDE, RULES.sharp - 0.05), GUIDE, sameName)).toBe("none");
  });
});
