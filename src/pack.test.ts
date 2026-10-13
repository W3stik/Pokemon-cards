import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectedPerPack, PACKS, oddsTable, packProfile, packSize, rarityInfo, RARITIES } from "./odds";
import { byRarity, fromSealed, hintLevel, isGodPack, isHallWorthy, openPack, toSealed } from "./pack";
import { getState, nextSealed, pickFromShelf, recordOpening, resetState, setShelf } from "./store";
import type { Card, SetInfo } from "./types";
import { PACK_PRODUCTS } from "./ui/pack";

const dataDir = new URL("../public/data/", import.meta.url);
const sets: SetInfo[] = JSON.parse(readFileSync(new URL("sets.json", dataDir), "utf8"));
const cardsOf = (id: string): Card[] => JSON.parse(readFileSync(new URL(`${id}.json`, dataDir), "utf8"));

/** Deterministický generátor (mulberry32), aby testy nebyly náhodné. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("data a konfigurace šancí", () => {
  it("každá sada má profil balíčku i fotku obalu", () => {
    expect(sets.length).toBeGreaterThanOrEqual(10);
    for (const set of sets) {
      expect(PACKS[set.id], set.id).toBeDefined();
      expect(PACK_PRODUCTS[set.id], set.id).toBeDefined();
    }
  });

  it("každá rarita v profilu existuje v datech sady a naopak má každá karta známou raritu", () => {
    for (const set of sets) {
      const pools = byRarity(cardsOf(set.id));
      const profile = packProfile(set.id);
      for (const slot of [...profile.slots, ...(profile.godPack?.slots ?? [])]) {
        for (const outcome of [slot.base, ...slot.hits]) {
          const size = outcome.rarities.reduce((n, r) => n + (pools.get(r)?.length ?? 0), 0);
          expect(size, `${set.id}: ${outcome.rarities.join("/")}`).toBeGreaterThan(0);
        }
      }
      for (const rarity of pools.keys()) expect(RARITIES[rarity], `${set.id}: ${rarity}`).toBeDefined();
    }
  });

  it("čísla karet v sadě jsou jedinečná a odpovídají id", () => {
    for (const set of sets) {
      const main = cardsOf(set.id).filter((c) => !c.prefix);
      expect(new Set(main.map((c) => c.number)).size, set.id).toBe(main.length);
      for (const c of main) expect(c.id, c.name).toBe(`${set.id}-${c.number}`);
    }
  });

  it("karty za hranicí sady (tajné) nemají obyčejnou raritu", () => {
    // Chytilo by to chyby zdroje jako Victini z Black Bolt označený jako „Rare“ (cena 600 $).
    for (const set of sets) {
      for (const c of cardsOf(set.id).filter((c) => !c.prefix && c.number > set.printedTotal)) {
        expect(["Common", "Uncommon", "Rare", "Double Rare"], `${c.id} ${c.name}`).not.toContain(c.rarity);
      }
    }
  });

  it("součet šancí ve slotu nepřesáhne 100 %", () => {
    for (const [id, profile] of Object.entries(PACKS)) {
      for (const slot of [...profile.slots, ...(profile.godPack?.slots ?? [])]) {
        const sum = slot.hits.reduce((n, h) => n + (h.p ?? 0), 0);
        expect(sum, `${id}: ${slot.label}`).toBeLessThan(1);
      }
    }
  });

  it("tabulka šancí řadí od nejčastější", () => {
    const rows = oddsTable(packProfile("me1"));
    expect(rows[0].label).toBe("Double Rare");
    expect(rows.at(-1)?.label).toBe("Mega Hyper Rare");
  });
});

describe("otevírání balíčků", () => {
  it("standardní balíček má 10 karet a správné složení", () => {
    const pools = byRarity(cardsOf("me1"));
    const pack = openPack(packProfile("me1"), pools, seeded(1));
    expect(pack).toHaveLength(10);
    expect(pack.slice(0, 4).every((p) => p.card.rarity === "Common")).toBe(true);
    expect(pack.slice(4, 7).every((p) => p.card.rarity === "Uncommon")).toBe(true);
    expect(pack[7].variant).toBe("reverse");
    expect(rarityInfo(pack[9].card.rarity).rank).toBeGreaterThanOrEqual(rarityInfo("Rare").rank);
  });

  it("30th Celebration má 5 karet a poslední je vždy Pikachu Rare", () => {
    const pools = byRarity(cardsOf("me55"));
    const rng = seeded(7);
    for (let i = 0; i < 200; i++) {
      const pack = openPack(packProfile("me55"), pools, rng);
      expect(pack).toHaveLength(packSize(packProfile("me55")));
      expect(pack.at(-1)?.card.rarity).toBe("Pikachu Rare");
    }
  });

  it("v balíčku se neopakuje stejná karta ve stejném provedení", () => {
    const pools = byRarity(cardsOf("sv10"));
    const rng = seeded(3);
    for (let i = 0; i < 500; i++) {
      const keys = openPack(packProfile("sv10"), pools, rng).map((p) => `${p.card.id}|${p.variant}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("vzácný výsledek bez karet v sadě dá výchozí raritu, ne další vzácný výsledek", () => {
    const pools = byRarity(cardsOf("me1"));
    const profile = {
      colors: ["#000", "#fff"] as [string, string],
      sources: [],
      slots: [
        {
          label: "Test",
          count: 1,
          hits: [
            { rarities: ["Neexistující"], variant: "normal" as const, p: 0.5 },
            { rarities: ["Rare"], variant: "normal" as const, p: 0.5 },
          ],
          base: { rarities: ["Common"], variant: "normal" as const },
        },
      ],
    };
    const rolls = [0.3, 0];
    const pack = openPack(profile, pools, () => rolls.shift() ?? 0);
    expect(pack[0].card.rarity).toBe("Common");
  });

  it("četnost rarit odpovídá nastaveným šancím", () => {
    const profile = packProfile("me2");
    const pools = byRarity(cardsOf("me2"));
    const rng = seeded(42);
    const n = 100_000;
    const counts = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      for (const { card } of openPack(profile, pools, rng)) {
        counts.set(card.rarity, (counts.get(card.rarity) ?? 0) + 1);
      }
    }
    const rate = (r: string) => (counts.get(r) ?? 0) / n;
    expect(rate("Double Rare")).toBeCloseTo(0.2077, 2);
    expect(rate("Illustration Rare")).toBeCloseTo(0.1097, 2);
    expect(rate("Ultra Rare")).toBeCloseTo(0.0806, 2);
    expect(rate("Special Illustration Rare")).toBeCloseTo(0.0125, 2);
  });
});

describe("měřák štěstí a Síň slávy", () => {
  const poolSizes = (id: string) => new Map([...byRarity(cardsOf(id))].map(([r, list]) => [r, list.length]));

  it("očekávané počty odpovídají šancím a skutečnému losování", () => {
    const exp = expectedPerPack(packProfile("me2"), poolSizes("me2"));
    expect(exp.get("Double Rare")).toBeCloseTo(0.2077, 4);
    expect(exp.get("Special Illustration Rare")).toBeCloseTo(0.0125, 4);
    expect(exp.get("Common")).toBeCloseTo(4, 4);
    // simulace sedí s výpočtem i u složité sady s god packem
    const profile = packProfile("me2pt5");
    const pools = byRarity(cardsOf("me2pt5"));
    const e2 = expectedPerPack(profile, poolSizes("me2pt5"));
    const rng = seeded(5);
    let sir = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) sir += openPack(profile, pools, rng).filter((p) => p.card.rarity === "Special Illustration Rare").length;
    expect(sir / n).toBeCloseTo(e2.get("Special Illustration Rare")!, 2);
  }, 30_000);

  it("do Síně slávy jdou jen balíčky s Ultra Rare a vzácnější kartou", () => {
    const cards = cardsOf("me1");
    const pack = (...rarities: string[]) => rarities.map((r) => ({ card: cards.find((c) => c.rarity === r)! }));
    expect(isHallWorthy(pack("Common", "Illustration Rare", "Double Rare"))).toBe(false);
    expect(isHallWorthy(pack("Common", "Ultra Rare"))).toBe(true);
    expect(isHallWorthy(pack("Common", "Special Illustration Rare"))).toBe(true);
    expect(isHallWorthy(pack("Mega Hyper Rare"))).toBe(true);
  });
});

describe("god pack", () => {
  const profile = packProfile("me2pt5");
  const pools = byRarity(cardsOf("me2pt5"));
  /** Generátor, jehož první hod (losování god packu) padne vždy. */
  const forcedGod = (seed: number) => {
    const rng = seeded(seed);
    let first = true;
    return () => (first ? ((first = false), 0) : rng());
  };

  it("Ascended Heroes má god pack 1:500 a je v tabulce šancí", () => {
    expect(profile.godPack?.p).toBe(1 / 500);
    expect(oddsTable(profile).some((r) => r.label.startsWith("God pack") && r.p === 1 / 500)).toBe(true);
  });

  it("god pack má 10 vzácných karet ve správném pořadí a bez opakování", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const pack = openPack(profile, pools, forcedGod(seed));
      const r = pack.map((p) => p.card.rarity);
      expect(pack).toHaveLength(10);
      expect(isGodPack(pack)).toBe(true);
      expect(r.slice(0, 4).every((x) => x === "Illustration Rare")).toBe(true);
      expect(r.slice(4, 7).every((x) => x === "Ultra Rare" || x === "Mega Attack Rare")).toBe(true);
      expect(r.slice(7, 9).every((x) => x === "Special Illustration Rare")).toBe(true);
      expect(["Special Illustration Rare", "Mega Hyper Rare"]).toContain(r[9]);
      expect(new Set(pack.map((p) => p.card.id)).size).toBe(10);
    }
  });

  it("padá zhruba jednou za 500 balíčků a běžný balíček god pack není", () => {
    const rng = seeded(11);
    const n = 50_000;
    let god = 0;
    for (let i = 0; i < n; i++) if (isGodPack(openPack(profile, pools, rng))) god++;
    // očekávání 100, směrodatná odchylka ~10
    expect(god).toBeGreaterThan(65);
    expect(god).toBeLessThan(135);
    const me1 = byRarity(cardsOf("me1"));
    for (let i = 0; i < 2000; i++) expect(isGodPack(openPack(packProfile("me1"), me1, rng))).toBe(false);
  }, 30_000);
});

describe("regál a předem určené balíčky", () => {
  const cards = cardsOf("me1");
  const pools = byRarity(cards);
  const byId = new Map(cards.map((c) => [c.id, c]));

  it("uložený balíček se obnoví na stejné karty", () => {
    const pack = openPack(packProfile("me1"), pools, seeded(5));
    expect(fromSealed(toSealed(pack), byId)).toEqual(pack);
    expect(fromSealed({ cards: [{ id: "neexistuje-1", variant: "normal" }] }, byId)).toBeNull();
  });

  it("náznak odpovídá nejvzácnější kartě v balíčku", () => {
    const of = (rarity: string) => [{ card: cards.find((c) => c.rarity === rarity)!, variant: "normal" as const }];
    expect(hintLevel(of("Double Rare"))).toBe(0);
    expect(hintLevel(of("Illustration Rare"))).toBe(1);
    expect(hintLevel(of("Ultra Rare"))).toBe(1);
    expect(hintLevel(of("Special Illustration Rare"))).toBe(2);
    expect(hintLevel(of("Mega Hyper Rare"))).toBe(3);
  });

  it("vybraný balíček z regálu se otevře jako první a jeho místo zaplní nový", () => {
    resetState();
    const shelf = Array.from({ length: 10 }, (_, i) => toSealed(openPack(packProfile("me1"), pools, seeded(100 + i))));
    setShelf("me1", shelf);
    const replacement = toSealed(openPack(packProfile("me1"), pools, seeded(999)));
    pickFromShelf("me1", 3, replacement);

    expect(getState().packs.me1).toBe(1);
    expect(nextSealed("me1")).toEqual(shelf[3]);
    expect(getState().shelf.me1[3]).toEqual(replacement);

    recordOpening("me1", fromSealed(shelf[3], byId)!);
    expect(getState().packs.me1).toBeUndefined();
    expect(nextSealed("me1")).toBeUndefined();
  });
});
