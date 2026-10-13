// Reálné tržní ceny karet (Cardmarket v EUR, TCGplayer v USD).
//  1. data/prices.json: ceny z TCGdex stažené při buildu (scripts/fetch-prices.mjs, CI denně),
//     takže jsou k dispozici hned a i offline. Pokrývají všechny sady.
//  2. TCGdex (api.tcgdex.net) živě pro jednu kartu v jejím detailu.
// (Dřívější záloha přes Pokémon TCG API po sadách byla pomalá a nespolehlivá a s cenami
// pro všechny sady v souboru už nebyla potřeba.)
import { parseTcgdexPricing } from "./tcgdexPricing.js";
import type { Card, Variant } from "./types";

export interface CardPrice {
  /** Cardmarket trend v EUR. */
  eur?: number;
  eurReverse?: number;
  /** TCGplayer market price v USD. */
  usd?: number;
  usdReverse?: number;
  cardmarketUrl?: string;
  tcgplayerUrl?: string;
  source: "tcgdex";
  updated?: string;
}

type PriceMap = Record<string, CardPrice>;

const TCGDEX = "https://api.tcgdex.net/v2/en";

// Úklid: ceny stažené dřívější zálohou přes Pokémon TCG API (klíče pokemon-packs:prices:*).
try {
  for (const key of Object.keys(localStorage)) if (key.startsWith("pokemon-packs:prices:")) localStorage.removeItem(key);
} catch {
  // nevadí
}

interface BundledFile {
  updated: string;
  cards: Record<string, Omit<CardPrice, "source">>;
}

let bundled: Promise<Map<string, PriceMap>> | null = null;

/** Ceny přibalené k aplikaci, rozdělené podle sady. */
function loadBundled(): Promise<Map<string, PriceMap>> {
  bundled ??= fetch(`${import.meta.env.BASE_URL}data/prices.json`)
    .then((res) => (res.ok ? (res.json() as Promise<BundledFile>) : null))
    .then((file) => {
      const bySet = new Map<string, PriceMap>();
      if (!file) return bySet;
      for (const [id, price] of Object.entries(file.cards)) {
        const setId = id.slice(0, id.lastIndexOf("-"));
        const map = bySet.get(setId) ?? {};
        map[id] = { ...price, source: "tcgdex", updated: file.updated.slice(0, 10) };
        bySet.set(setId, map);
      }
      return bySet;
    })
    .catch(() => new Map());
  return bundled;
}

/** Ceny všech karet sad (včetně podsad, např. me55 + me55c) z přibaleného souboru. */
export async function loadSetPrices(setIds: string[]): Promise<PriceMap> {
  const local = await loadBundled();
  return Object.assign({}, ...setIds.map((id) => local.get(id) ?? {}));
}

/** Cena konkrétního provedení karty. Reverse a vzorované holo mají vlastní cenu, pokud ji trh uvádí. */
export function variantPrice(price: CardPrice | undefined, variant: Variant): { eur?: number; usd?: number } {
  if (!price) return {};
  if (variant === "normal") return { eur: price.eur, usd: price.usd };
  return { eur: price.eurReverse ?? price.eur, usd: price.usdReverse ?? price.usd };
}

// --- Záloha: TCGdex, jen pro jednotlivou kartu -----------------------------

let tcgdexSets: Promise<{ id: string; name: string }[]> | null = null;
const tcgdexSetCards = new Map<string, Promise<{ id: string; localId: string; name: string }[]>>();

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Dohledá cenu jedné karty v TCGdex podle názvu sady a čísla (nebo jména u podsad). */
export async function tcgdexPrice(card: Card, setName: string): Promise<CardPrice | undefined> {
  try {
    tcgdexSets ??= getJson(`${TCGDEX}/sets`);
    const sets = await tcgdexSets;
    const want = setName.toLowerCase();
    const set = sets.find((s) => s.name.toLowerCase() === want);
    if (!set) return undefined;

    let cards = tcgdexSetCards.get(set.id);
    if (!cards) {
      cards = getJson<{ cards: { id: string; localId: string; name: string }[] }>(`${TCGDEX}/sets/${set.id}`).then(
        (s) => s.cards,
      );
      tcgdexSetCards.set(set.id, cards);
    }
    const match = card.prefix
      ? (await cards).find((c) => c.name === card.name)
      : (await cards).find((c) => Number(c.localId) === card.number);
    if (!match) return undefined;

    const full = await getJson<{ pricing?: { cardmarket?: { updated?: unknown } } }>(`${TCGDEX}/cards/${match.id}`);
    if (!full.pricing) return undefined;
    const updated = full.pricing.cardmarket?.updated;
    return { ...parseTcgdexPricing(full.pricing), source: "tcgdex", updated: typeof updated === "string" ? updated : undefined };
  } catch {
    tcgdexSets = null;
    return undefined;
  }
}

const eurFmt = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "EUR" });
const usdFmt = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "USD" });

export const formatEur = (v: number | undefined) => (v === undefined ? "–" : eurFmt.format(v));
export const formatUsd = (v: number | undefined) => (v === undefined ? "–" : usdFmt.format(v));

/** Součet cen. Měna, ve které žádná karta cenu nemá, zůstane prázdná (nezobrazí se jako 0). */
export interface PriceTotal {
  eur?: number;
  usd?: number;
}

export function addPrice(total: PriceTotal, price: { eur?: number; usd?: number }, count = 1) {
  if (price.eur !== undefined) total.eur = (total.eur ?? 0) + price.eur * count;
  if (price.usd !== undefined) total.usd = (total.usd ?? 0) + price.usd * count;
}

export function formatTotal(total: PriceTotal, withSource = false): string {
  const parts: string[] = [];
  if (total.eur !== undefined) parts.push(`${formatEur(total.eur)}${withSource ? " (Cardmarket)" : ""}`);
  if (total.usd !== undefined) parts.push(`${formatUsd(total.usd)}${withSource ? " (TCGplayer)" : ""}`);
  return parts.length ? parts.join(" · ") : "ceny nejsou dostupné";
}

/** Hodnota pro řazení: přednostně EUR (Cardmarket), jinak USD. */
export const sortValue = (p: { eur?: number; usd?: number }) => p.eur ?? p.usd ?? -1;
