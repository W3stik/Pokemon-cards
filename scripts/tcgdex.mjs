// Společné pomůcky pro skripty, které berou data z TCGdex (ceny, obrázky karet).
export const API = "https://api.tcgdex.net/v2/en";
export const CONCURRENCY = 8;
export const HEADERS = { "User-Agent": "BoosterLab (github.com/W3stik/Pokemon-cards)" };

export async function getJson(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
}

/** Zpracuje položky souběžně; chyba u položky vrátí `{ error }` místo výsledku. */
export async function pool(items, fn, concurrency = CONCURRENCY) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]).catch((err) => ({ error: err.message }));
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

/** Stejná karta podle jména, s tolerancí k diakritice, interpunkci a příponám („ex“ apod.). */
const loose = (name) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
const sameName = (a, b) => {
  const x = loose(a);
  const y = loose(b);
  return x === y || x.startsWith(y) || y.startsWith(x);
};

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

/**
 * Spáruje naše karty sady s kartami TCGdex: hlavní sadu podle čísla, podsady podle jména.
 * Vrací `{ remote, pairs: [[naše id, karta TCGdex], …] }`, nebo null, když sada v TCGdex není.
 */
export async function pairSet(set, cards, tcgdexSets) {
  const remote = tcgdexSets.find((s) => s.name.toLowerCase() === set.name.toLowerCase());
  if (!remote) {
    console.warn(`${set.id}: sada „${set.name}“ v TCGdex není`);
    return null;
  }
  const byNumber = new Map(cards.filter((c) => !c.prefix).map((c) => [c.number, c]));
  const { cards: list } = await getJson(`${API}/sets/${remote.id}`);
  // Podle čísla, ale jen když sedí i jméno: číslování se občas liší
  // (Black Bolt č. 80 je u nás Antique Cover Fossil, v TCGdex Escavalier).
  const pairs = list.flatMap((c) => {
    const ours = byNumber.get(Number(c.localId));
    if (!ours) return [];
    if (!sameName(ours.name, c.name)) {
      console.warn(`  ${ours.id} („${ours.name}“) má v TCGdex pod stejným číslem „${c.name}“, vynechána`);
      return [];
    }
    return [[ours.id, c]];
  });

  for (const [prefix, subId] of Object.entries(TCGDEX_SUBSETS[set.id] ?? {})) {
    const sub = await getJson(`${API}/sets/${subId}`).catch(() => null);
    if (!sub) {
      console.warn(`${set.id}: podsada ${subId} v TCGdex není`);
      continue;
    }
    pairs.push(...pairByName(cards.filter((c) => c.prefix === prefix), sub.cards));
  }
  return { remote, pairs };
}
