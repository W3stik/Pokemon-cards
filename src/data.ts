import { byRarity } from "./pack";
import type { Card, SetInfo } from "./types";

const base = import.meta.env.BASE_URL;

let setsPromise: Promise<SetInfo[]> | null = null;
const cardCache = new Map<string, Promise<Card[]>>();
const poolCache = new Map<string, Map<string, Card[]>>();

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}data/${path}`);
  if (!res.ok) throw new Error(`Nepodařilo se načíst ${path} (HTTP ${res.status})`);
  return res.json() as Promise<T>;
}

export function loadSets(): Promise<SetInfo[]> {
  setsPromise ??= getJson<SetInfo[]>("sets.json");
  return setsPromise;
}

export function loadCards(setId: string): Promise<Card[]> {
  let p = cardCache.get(setId);
  if (!p) {
    p = getJson<Card[]>(`${setId}.json`);
    cardCache.set(setId, p);
    p.catch(() => cardCache.delete(setId));
  }
  return p;
}

export async function loadPools(setId: string): Promise<Map<string, Card[]>> {
  const cached = poolCache.get(setId);
  if (cached) return cached;
  const pools = byRarity(await loadCards(setId));
  poolCache.set(setId, pools);
  return pools;
}

/**
 * Sada, do které karta patří: přesná shoda id, jinak nejdelší sada, jejímž id karta
 * začíná (podsady jako me55c Classic Collection → me55).
 */
export function setOfCard(cardId: string, sets: SetInfo[]): SetInfo | undefined {
  const sid = setIdOfCard(cardId);
  return sets.find((s) => s.id === sid) ?? sets.filter((s) => sid.startsWith(s.id)).sort((a, b) => b.id.length - a.id.length)[0];
}

/** Id sady, ze které karta pochází (u podsad např. me55c → me55). */
export const setIdOfCard = (cardId: string) => cardId.slice(0, cardId.lastIndexOf("-"));

export const cardNumber = (card: Card) => `${card.prefix ?? ""}${card.number}`;
