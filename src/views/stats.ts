// Statistiky: měřák štěstí (kolik vzácných karet padlo proti očekávání podle šancí)
// a Síň slávy (natrvalo uložené balíčky s opravdu dobrými kartami).
import { loadCards, loadSets, setIdOfCard, setOfCard } from "../data";
import { locale, t } from "../i18n";
import { expectedPerPack, packProfile, rarityInfo } from "../odds";
import { addPrice, formatTotal, loadSetPrices, type PriceTotal, variantPrice } from "../prices";
import { addToHall, getState, type PullRecord } from "../store";
import type { Card, SetInfo, Variant } from "../types";
import { h } from "../ui/dom";
import { cardEl } from "../ui/holo";
import { openCardModal } from "./cardModal";

const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
const small = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
/** Očekávaný počet: malé hodnoty se dvěma desetinnými místy (0,04 místo 0). */
const expectedText = (v: number) => (v > 0 && v < 0.1 ? small.format(v) : num.format(v));
/** Měřák počítá s raritami od Double Rare výš (běžné karty padají pořád). */
const LUCK_MIN_RANK = 4;

async function cardsById(setIds: string[]): Promise<Map<string, Card>> {
  const map = new Map<string, Card>();
  for (const cards of await Promise.all(setIds.map((id) => loadCards(id)))) for (const c of cards) map.set(c.id, c);
  return map;
}

// --- Měřák štěstí -------------------------------------------------------------

interface LuckRow {
  rarity: string;
  actual: number;
  expected: number;
}

function luckRows(sets: SetInfo[], cards: Map<string, Card>, setFilter: string): LuckRow[] {
  const { opened, collection } = getState();
  const rows = new Map<string, LuckRow>();
  const row = (rarity: string) => {
    let r = rows.get(rarity);
    if (!r) rows.set(rarity, (r = { rarity, actual: 0, expected: 0 }));
    return r;
  };
  for (const set of sets) {
    if (setFilter && set.id !== setFilter) continue;
    const packs = opened[set.id] ?? 0;
    if (!packs) continue;
    const pool = new Map<string, number>();
    for (const c of cards.values()) if (setOfCard(c.id, sets)?.id === set.id) pool.set(c.rarity, (pool.get(c.rarity) ?? 0) + 1);
    for (const [rarity, perPack] of expectedPerPack(packProfile(set.id), pool)) {
      if (rarityInfo(rarity).rank >= LUCK_MIN_RANK) row(rarity).expected += perPack * packs;
    }
  }
  // Skutečně vytažené: všechny kusy ve sbírce (karty se z ní nikdy neodebírají).
  for (const [key, n] of Object.entries(collection)) {
    const card = cards.get(key.slice(0, key.lastIndexOf("|")));
    if (!card || rarityInfo(card.rarity).rank < LUCK_MIN_RANK) continue;
    if (setFilter && setOfCard(card.id, sets)?.id !== setFilter) continue;
    row(card.rarity).actual += n;
  }
  return [...rows.values()]
    .filter((r) => r.actual > 0 || r.expected >= 0.05)
    .sort((a, b) => rarityInfo(b.rarity).rank - rarityInfo(a.rarity).rank || b.expected - a.expected);
}

function verdict(rows: LuckRow[]): { text: string; tone: string } {
  // Souhrn jen ze vzácnějších (od Illustration Rare), Double Rare padá skoro v každém pátém balíčku.
  const rare = rows.filter((r) => rarityInfo(r.rarity).rank >= 6);
  const actual = rare.reduce((n, r) => n + r.actual, 0);
  const expected = rare.reduce((n, r) => n + r.expected, 0);
  if (expected < 3) return { text: t.stats.tooFew, tone: "neutral" };
  const ratio = actual / expected;
  if (ratio >= 1.3) return { text: t.stats.lucky(actual, num.format(expected), num.format(ratio)), tone: "good" };
  if (ratio <= 0.77) return { text: t.stats.unlucky(actual, num.format(expected), num.format(ratio)), tone: "bad" };
  return { text: t.stats.normal(actual, num.format(expected)), tone: "neutral" };
}

function luckSection(sets: SetInfo[], cards: Map<string, Card>): HTMLElement {
  const opened = getState().opened;
  const openedSets = sets.filter((s) => opened[s.id]);
  const body = h("div");
  const select = h(
    "select",
    { "aria-label": t.stats.setFilter },
    h("option", { value: "" }, t.stats.allSets),
    ...openedSets.map((s) => h("option", { value: s.id }, `${s.name} (${opened[s.id]}×)`)),
  );
  const render = () => {
    const rows = luckRows(sets, cards, select.value);
    const v = verdict(rows);
    body.replaceChildren(
      h("p", { class: `luck__verdict luck__verdict--${v.tone}` }, v.text),
      rows.length
        ? h(
            "table",
            { class: "luck__table" },
            h("thead", null, h("tr", null, h("th", null, t.stats.rarity), h("th", null, t.stats.have), h("th", null, t.stats.expected), h("th", null, ""))),
            h(
              "tbody",
              null,
              ...rows.map((r) => {
                const ratio = r.expected > 0 ? r.actual / r.expected : r.actual > 0 ? Infinity : 1;
                const info = rarityInfo(r.rarity);
                return h(
                  "tr",
                  null,
                  h("td", null, h("span", { class: "rarity-chip", style: `--rc: ${info.color}` }, info.short), ` ${r.rarity}`),
                  h("td", null, String(r.actual)),
                  h("td", null, expectedText(r.expected)),
                  h("td", null, luckBar(ratio)),
                );
              }),
            ),
          )
        : h("p", { class: "muted" }, t.stats.noneOpened),
      h("p", { class: "muted small" }, t.stats.expectedNote),
    );
  };
  select.addEventListener("change", render);
  render();
  return h(
    "section",
    { class: "panel" },
    h("div", { class: "row luck__head" }, h("h2", null, t.stats.luckTitle), h("label", { class: "field" }, select)),
    body,
  );
}

/** Pruh poměru skutečnost / očekávání (střed = přesně podle šancí). */
function luckBar(ratio: number): HTMLElement {
  const clamped = Math.min(2, Math.max(0, Number.isFinite(ratio) ? ratio : 2));
  const tone = ratio >= 1.3 ? "good" : ratio <= 0.77 ? "bad" : "neutral";
  return h(
    "div",
    { class: `luck__bar luck__bar--${tone}`, title: Number.isFinite(ratio) ? `${num.format(ratio)}×` : "∞" },
    h("i", { style: `width: ${(clamped / 2) * 100}%` }),
  );
}

// --- Síň slávy ------------------------------------------------------------------

function hallSection(sets: SetInfo[], cards: Map<string, Card>): HTMLElement {
  const hall = getState().hallOfFame;
  const list = h("div", { class: "hall" });
  const sort = h(
    "select",
    { "aria-label": t.stats.sort },
    h("option", { value: "new" }, t.stats.newest),
    h("option", { value: "value" }, t.stats.mostValuable),
  );
  let prices: Awaited<ReturnType<typeof loadSetPrices>> = {};

  const pulled = (r: PullRecord) =>
    r.cards
      .flatMap((ref) => {
        const card = cards.get(ref.id);
        return card ? [{ card, variant: ref.variant as Variant }] : [];
      })
      .sort((a, b) => rarityInfo(b.card.rarity).rank - rarityInfo(a.card.rarity).rank);
  const valueOf = (r: PullRecord) => {
    const total: PriceTotal = {};
    for (const ref of r.cards) addPrice(total, variantPrice(prices[ref.id], ref.variant));
    return total;
  };
  const amount = (total: PriceTotal) => total.eur ?? total.usd ?? 0;

  // Každý balíček se vytvoří jednou; řazení jen přeskládá hotové prvky a načtené ceny
  // doplní hodnotu. (Dřív se po načtení cen celý seznam vytvořil znovu: karty problikly
  // a klepnutí v tu chvíli mohlo trefit odkaz, který už na stránce nebyl.)
  const values = new Map<PullRecord, HTMLElement>();
  const packEls = new Map(
    hall.map((r) => {
      const set = sets.find((s) => s.id === r.setId);
      const value = h("span", { class: "hall__value" });
      values.set(r, value);
      const el = h(
        "article",
        { class: "hall__pack hall__pack--god" },
        h(
          "div",
          { class: "hall__head" },
          h("strong", null, set?.name ?? r.setId),
          h("span", { class: "badge hall__god" }, "GOD PACK"),
          h("span", { class: "muted small" }, dateFmt.format(r.at)),
          value,
        ),
        h(
          "div",
          { class: "hall__cards" },
          ...pulled(r).map((p) =>
            h(
              "button",
              { class: "hall__card", onclick: () => set && openCardModal(p.card, set), title: `${p.card.name} – ${p.card.rarity}` },
              cardEl(p.card, p.variant),
              h("span", { class: "rarity-chip", style: `--rc: ${rarityInfo(p.card.rarity).color}` }, rarityInfo(p.card.rarity).short),
            ),
          ),
        ),
        h("a", { class: "btn btn--primary hall__replay", href: `#/replay/${r.at}` }, t.stats.replay),
      );
      return [r, el] as const;
    }),
  );

  const render = () => {
    const entries = [...hall];
    if (sort.value === "value") entries.sort((a, b) => amount(valueOf(b)) - amount(valueOf(a)));
    list.replaceChildren(...entries.map((r) => packEls.get(r)!));
    if (entries.length === 0) list.append(h("p", { class: "muted" }, t.stats.hallEmpty));
  };
  sort.addEventListener("change", render);
  render();
  if (hall.length) {
    loadSetPrices([...new Set(hall.flatMap((r) => r.cards.map((c) => setIdOfCard(c.id))))]).then((p) => {
      prices = p;
      for (const [r, el] of values) el.textContent = formatTotal(valueOf(r));
      if (sort.value === "value") render();
    });
  }

  return h(
    "section",
    { class: "panel" },
    h(
      "div",
      { class: "row luck__head" },
      h("h2", null, t.stats.hallTitle, h("span", { class: "muted" }, ` · ${hall.length}`)),
      hall.length > 1 ? h("label", { class: "field" }, sort) : null,
    ),
    h(
      "p",
      { class: "muted small" },
      t.stats.hallIntro,
    ),
    list,
  );
}

export async function renderStats(root: HTMLElement) {
  const sets = await loadSets();
  const state = getState();
  // Karty jen ze sad, které hráč otevíral nebo jsou v Síni slávy / historii.
  const needed = new Set<string>(Object.keys(state.opened));
  for (const r of [...state.hallOfFame, ...state.history]) needed.add(r.setId);
  const setIds = sets.filter((s) => needed.has(s.id)).map((s) => s.id);
  const cards = await cardsById(setIds);

  // God packy z historie, otevřené dřív, než vznikla Síň slávy, se do ní doplní.
  addToHall(state.history.filter((r) => r.god));

  root.append(
    h(
      "section",
      { class: "view-head" },
      h("a", { class: "back", href: "#/album" }, t.stats.back),
      h("h1", null, t.stats.title),
    ),
    luckSection(sets, cards),
    hallSection(sets, cards),
  );
}
