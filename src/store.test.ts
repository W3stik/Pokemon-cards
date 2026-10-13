import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Card } from "./types";

// Úložiště prohlížeče v paměti; store se načte až potom (dynamický import).
const storage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, String(v)),
  removeItem: (k: string) => void storage.delete(k),
  clear: () => storage.clear(),
  key: (i: number) => [...storage.keys()][i] ?? null,
  get length() {
    return storage.size;
  },
} as Storage;

const KEY = "pokemon-packs:state:v1";
let store: typeof import("./store");

beforeAll(async () => {
  store = await import("./store");
});

beforeEach(() => store.resetState());

describe("záloha sbírky", () => {
  it("odmítne soubor, který není záloha", () => {
    expect(() => store.parseBackup("nesmysl")).toThrow("chybný JSON");
    expect(() => store.parseBackup("[]")).toThrow("Soubor neobsahuje zálohu sbírky");
    expect(() => store.parseBackup(JSON.stringify({ version: 2, collection: {} }))).toThrow();
  });

  it("z poškozené zálohy převezme jen platné položky", () => {
    const backup = store.parseBackup(
      JSON.stringify({
        version: 1,
        packs: { me1: 2, me2: -1, me3: "5" },
        collection: { "me1-1|normal": 3, "me1-2|holo": 1, "me1-3|reverse": 0, bez: 1 },
        firstSeen: { "me1-1": 1700000000000, "me1-2": "včera" },
        opened: [],
        history: [{ setId: "me1", at: 1, cards: [{ id: "me1-1", variant: "normal" }] }, { setId: "me1" }],
        shelf: { me1: [{ cards: [{ id: "me1-1", variant: "normal" }] }, { cards: [{ id: 5 }] }] },
        sealed: { me1: [1, 2, 3].map(() => ({ cards: [{ id: "me1-1", variant: "normal" }] })), me2: [{ cards: [] }] },
      }),
    );
    expect(backup.packs).toEqual({ me1: 2 });
    expect(backup.collection).toEqual({ "me1-1|normal": 3 });
    expect(backup.firstSeen).toEqual({ "me1-1": 1700000000000 });
    expect(backup.opened).toEqual({});
    expect(backup.history).toHaveLength(1);
    expect(backup.shelf.me1).toHaveLength(1);
    // Vybraných balíčků nesmí být víc než neotevřených.
    expect(backup.sealed).toEqual({ me1: backup.sealed.me1 });
    expect(backup.sealed.me1).toHaveLength(2);
  });

  it("import nahradí celou sbírku", () => {
    store.addPacks("me1", 5);
    store.importState(JSON.stringify({ version: 1, collection: { "me2-1|reverse": 2 } }));
    expect(store.getState().packs).toEqual({});
    expect(store.getState().collection).toEqual({ "me2-1|reverse": 2 });
    expect(store.stateSummary()).toEqual({ cards: 2, packs: 0 });
  });
});

describe("god packy ve statistikách", () => {
  const card = (id: string, rarity: string): Card => ({
    id,
    name: id,
    number: 1,
    rarity,
    supertype: "Pokémon",
    subtypes: [],
    types: [],
    hp: null,
    artist: null,
    img: "",
    imgLarge: "",
  });

  it("otevřený god pack se započítá a označí v historii", () => {
    store.addPacks("me2pt5", 2);
    const god = Array.from({ length: 10 }, (_, i) => ({ card: card(`me2pt5-${200 + i}`, "Illustration Rare"), variant: "normal" as const }));
    store.recordOpening("me2pt5", god);
    store.recordOpening("me2pt5", [{ card: card("me2pt5-1", "Common"), variant: "normal" }, ...god.slice(1)]);
    expect(store.getState().godPacks).toEqual({ me2pt5: 1 });
    expect(store.getState().history.map((h) => h.god ?? false)).toEqual([false, true]);
    // přežije uložení a načtení zálohy
    expect(store.parseBackup(store.exportState()).godPacks).toEqual({ me2pt5: 1 });
  });
});

describe("Síň slávy a hromadné otevírání", () => {
  const card = (id: string, rarity: string): Card => ({
    id, name: id, number: 1, rarity, supertype: "Pokémon", subtypes: [], types: [], hp: null, artist: null, img: "", imgLarge: "",
  });
  const god = Array.from({ length: 10 }, (_, i) => ({ card: card(`me2pt5-${200 + i}`, "Illustration Rare"), variant: "normal" as const }));
  const normal = [{ card: card("me1-1", "Common"), variant: "normal" as const }, { card: card("me1-177", "Special Illustration Rare"), variant: "normal" as const }];

  it("ukládá natrvalo jen god packy", () => {
    store.addPacks("me2pt5", 40);
    store.recordOpening("me2pt5", normal);
    store.recordOpening("me2pt5", god);
    for (let i = 0; i < 35; i++) store.recordOpening("me2pt5", normal);
    expect(store.getState().history).toHaveLength(30);
    expect(store.getState().hallOfFame).toHaveLength(1);
    expect(store.getState().hallOfFame[0].god).toBe(true);
    expect(store.parseBackup(store.exportState()).hallOfFame).toHaveLength(1);
  });

  it("starší záznamy Síně slávy bez god packu se při načtení zahodí", () => {
    const backup = store.parseBackup(
      JSON.stringify({
        version: 1,
        collection: {},
        hallOfFame: [
          { setId: "me1", at: 2, cards: [{ id: "me1-177", variant: "normal" }] },
          { setId: "me2pt5", at: 1, cards: [{ id: "me2pt5-200", variant: "normal" }], god: true },
        ],
      }),
    );
    expect(backup.hallOfFame.map((r) => r.at)).toEqual([1]);
  });

  it("Otevřít vše zapíše všechny balíčky jedním uložením se stejným výsledkem", () => {
    store.addPacks("me1", 5);
    const writes = { n: 0 };
    const orig = localStorage.setItem;
    localStorage.setItem = (k: string, v: string) => (writes.n++, orig.call(localStorage, k, v));
    const fresh = store.recordOpenings("me1", [normal, normal, normal]);
    localStorage.setItem = orig;
    expect(writes.n).toBe(1);
    expect(fresh[0].size).toBe(2);
    expect(fresh[1].size).toBe(0);
    expect(store.getState().packs.me1).toBe(2);
    expect(store.getState().opened.me1).toBe(3);
    expect(store.getState().collection["me1-177|normal"]).toBe(3);
    // každý balíček má vlastní čas
    expect(new Set(store.getState().history.slice(0, 3).map((r) => r.at)).size).toBe(3);
  });
});

describe("více oken", () => {
  it("změna nepřepíše to, co mezitím uložilo jiné okno", () => {
    store.addPacks("me1", 1);
    // Jiné okno mezitím otevřelo balíček a uložilo kartu.
    const other = JSON.parse(storage.get(KEY)!);
    other.collection["me1-7|normal"] = 1;
    storage.set(KEY, JSON.stringify(other));

    store.addPacks("me2", 3);
    expect(store.getState().collection["me1-7|normal"]).toBe(1);
    expect(store.getState().packs).toEqual({ me1: 1, me2: 3 });
  });

  it("poškozený zápis v úložišti hru nerozbije", () => {
    store.addPacks("me1", 1);
    storage.set(KEY, "{rozbité");
    store.addPacks("me1", 1);
    expect(store.getState().packs.me1).toBe(2);
  });
});
