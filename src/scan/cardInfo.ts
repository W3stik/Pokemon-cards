// Cena a provedení skutečné karty živě z TCGdex (po jedné kartě), s mezipamětí
// v localStorage na den – album Moje karty i skener se ptají opakovaně na stejné karty.
import type { CardPrice } from "../prices";
import { parseTcgdexPricing } from "../tcgdexPricing.js";

export interface CardInfo {
  price?: CardPrice;
  /** Vyšla karta jako reverse holo? (undefined = TCGdex to neuvádí) */
  reverse?: boolean;
  /** Kdy se údaj stáhl (ms). */
  at: number;
}

const KEY = "pokemon-packs:real-info";
const TTL = 24 * 3600 * 1000;
const TCGDEX = "https://api.tcgdex.net/v2/en/cards/";

let cache: Record<string, CardInfo> | null = null;
function load(): Record<string, CardInfo> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    cache = raw && typeof raw === "object" ? raw : {};
  } catch {
    cache = {};
  }
  return cache!;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      // plné úložiště: ceny se příště stáhnou znovu
    }
  }, 500);
}

/** Naposledy stažený údaj (i starší), bez dotazu na síť. */
export const cachedInfo = (id: string): CardInfo | undefined => load()[id];

const pending = new Map<string, Promise<CardInfo | undefined>>();
// najednou jen pár dotazů, ať album se stovkami karet nezahltí TCGdex
const queue: (() => void)[] = [];
let running = 0;
const LIMIT = 6;
function slot(): Promise<void> {
  if (running < LIMIT) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}
function release() {
  const next = queue.shift();
  if (next) next();
  else running--;
}

/** Cena a provedení karty; čerstvé z mezipaměti, jinak z TCGdex (bez sítě vrátí starší údaj). */
export function cardInfo(id: string): Promise<CardInfo | undefined> {
  const known = load()[id];
  if (known && Date.now() - known.at < TTL) return Promise.resolve(known);
  let request = pending.get(id);
  if (!request) {
    request = (async () => {
      await slot();
      try {
        const res = await fetch(TCGDEX + encodeURIComponent(id));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const card = (await res.json()) as { pricing?: unknown; variants?: { reverse?: boolean } };
        const info: CardInfo = { at: Date.now() };
        if (card.pricing) info.price = { ...parseTcgdexPricing(card.pricing), source: "tcgdex" };
        if (typeof card.variants?.reverse === "boolean") info.reverse = card.variants.reverse;
        load()[id] = info;
        save();
        return info;
      } catch {
        return known;
      } finally {
        release();
        pending.delete(id);
      }
    })();
    pending.set(id, request);
  }
  return request;
}
