import { describe, expect, it } from "vitest";
import { sanitizeFxPrefs } from "./ui/sfx";

describe("nastavení zvuku", () => {
  it("doplní chybějící hodnoty", () => {
    expect(sanitizeFxPrefs({})).toEqual({ sound: true, vibrate: true, volume: 1 });
  });

  it("opraví neplatné hodnoty (neplatná hlasitost by shodila zvuk i klepnutí)", () => {
    expect(sanitizeFxPrefs({ sound: "ano", vibrate: 0, volume: "hlasitě" })).toEqual({ sound: true, vibrate: true, volume: 1 });
    expect(sanitizeFxPrefs({ volume: Number.NaN }).volume).toBe(1);
    expect(sanitizeFxPrefs({ volume: 7 }).volume).toBe(1);
    expect(sanitizeFxPrefs({ volume: -2 }).volume).toBe(0);
  });

  it("zachová platné hodnoty", () => {
    expect(sanitizeFxPrefs({ sound: false, vibrate: false, volume: 0.35 })).toEqual({ sound: false, vibrate: false, volume: 0.35 });
  });

  it("snese i nesmysl místo objektu", () => {
    expect(sanitizeFxPrefs(null).volume).toBe(1);
    expect(sanitizeFxPrefs("x").sound).toBe(true);
  });
});
