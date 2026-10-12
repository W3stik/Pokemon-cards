// Stáhne aktuální tržní ceny všech karet z TCGdex (Cardmarket v EUR,
// TCGplayer v USD) a uloží je do public/data/prices.json, aby je aplikace
// měla hned a i offline. Spouští se v CI před buildem: npm run prices
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTcgdexPricing } from "../src/tcgdexPricing.js";

const API = "https://api.tcgdex.net/v2/en";
const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const CONCURRENCY = 8;

async function getJson(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
}

async function pool(items, fn) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]).catch(() => undefined);
      }
    }),
  );
  return results;
}

// Podsady sloučené do hlavní sady (prefix čísla → id podsady v TCGdex). TCGdex je čísluje
// jinak než my (my podle pořadí v pokemon-tcg-data), proto se párují podle jména.
const TCGDEX_SUBSETS = { me55: { CC: "30th-c" } };

// „Rayquaza-EX“ ~ „Rayquaza EX“, „Palkia LV.X“ ~ „Palkia“
const normName = (name) =>
  name
    .toLowerCase()
    .replace(/\s+lv\.x$/, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Páry [naše id, karta TCGdex] podle jména; stejná jména (např. dvě poloviny LEGEND) v pořadí. */
function pairByName(ours, remoteCards) {
  const queues = new Map();
  for (const c of remoteCards) {
    const key = normName(c.name);
    queues.set(key, [...(queues.get(key) ?? []), c]);
  }
  return ours.flatMap((c) => {
    const match = queues.get(normName(c.name))?.shift();
    if (!match) console.warn(`  ${c.id} („${c.name}“) v TCGdex nenalezena`);
    return match ? [[c.id, match]] : [];
  });
}

const sets = JSON.parse(await readFile(join(DATA, "sets.json"), "utf8"));
const tcgdexSets = await getJson(`${API}/sets`);
const cards = {};

for (const set of sets) {
  const remote = tcgdexSets.find((s) => s.name.toLowerCase() === set.name.toLowerCase());
  if (!remote) {
    console.warn(`${set.id}: sada „${set.name}“ v TCGdex není`);
    continue;
  }
  const all = JSON.parse(await readFile(join(DATA, `${set.id}.json`), "utf8"));
  const ours = all.filter((c) => !c.prefix);
  const byNumber = new Map(ours.map((c) => [c.number, c.id]));
  const { cards: list } = await getJson(`${API}/sets/${remote.id}`);
  const pairs = list.filter((c) => byNumber.has(Number(c.localId))).map((c) => [byNumber.get(Number(c.localId)), c]);

  for (const [prefix, subId] of Object.entries(TCGDEX_SUBSETS[set.id] ?? {})) {
    const sub = await getJson(`${API}/sets/${subId}`).catch(() => null);
    if (!sub) {
      console.warn(`${set.id}: podsada ${subId} v TCGdex není`);
      continue;
    }
    pairs.push(...pairByName(all.filter((c) => c.prefix === prefix), sub.cards));
  }

  const details = await pool(pairs, ([, c]) => getJson(`${API}/cards/${c.id}`));
  let priced = 0;
  pairs.forEach(([id], i) => {
    const price = parseTcgdexPricing(details[i]?.pricing);
    if (Object.keys(price).length) {
      cards[id] = price;
      priced++;
    }
  });
  console.log(`${set.id.padEnd(10)} ${remote.id.padEnd(8)} ${priced}/${all.length} karet s cenou`);
}

const out = { updated: new Date().toISOString(), source: "tcgdex", cards };
await writeFile(join(DATA, "prices.json"), JSON.stringify(out));
console.log(`Uloženo ${Object.keys(cards).length} cen do public/data/prices.json`);
