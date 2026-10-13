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

describe("Síň slávy", () => {
  const card = (id: string, rarity: string): Card => ({
    id, name: id, number: 1, rarity, supertype: "Pokémon", subtypes: [], types: [], hp: null, artist: null, img: "", imgLarge: "",
  });

  it("uloží jen dobré balíčky a natrvalo (přežijí historii i zálohu)", () => {
    store.addPacks("me1", 40);
    const common = { card: card("me1-1", "Common"), variant: "normal" as const };
    const sir = { card: card("me1-177", "Special Illustration Rare"), variant: "normal" as const };
    store.recordOpening("me1", [common, sir]);
    for (let i = 0; i < 35; i++) store.recordOpening("me1", [common]);
    expect(store.getState().history).toHaveLength(30);
    expect(store.getState().hallOfFame).toHaveLength(1);
    expect(store.getState().hallOfFame[0].cards.map((c) => c.id)).toEqual(["me1-1", "me1-177"]);
    expect(store.parseBackup(store.exportState()).hallOfFame).toHaveLength(1);
  });

  it("doplnění z historie nevytvoří duplikáty", () => {
    store.addPacks("me1", 1);
    store.recordOpening("me1", [{ card: card("me1-177", "Special Illustration Rare"), variant: "normal" }]);
    const record = store.getState().hallOfFame[0];
    store.addToHall([record, { ...record, at: record.at - 1000 }]);
    expect(store.getState().hallOfFame).toHaveLength(2);
    expect(store.getState().hallOfFame[0].at).toBeGreaterThan(store.getState().hallOfFame[1].at);
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
