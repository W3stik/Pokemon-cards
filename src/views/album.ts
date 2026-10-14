import { cardNumber, loadCards, loadSets, setIdOfCard, setOfCard } from "../data";
import { locale, t } from "../i18n";
import { RARITIES, rarityInfo } from "../odds";
import { addPrice, type CardPrice, formatEur, formatTotal, formatUsd, loadSetPrices, type PriceTotal, sortValue, variantPrice } from "../prices";
import { countsFor, getState } from "../store";
import type { Card, SetInfo, Variant } from "../types";
import { h } from "../ui/dom";
import { eraSection, groupBySeries } from "../ui/eras";
import { cardEl } from "../ui/holo";
import { openCardModal } from "./cardModal";

type Filter = "all" | "owned" | "missing" | "dupes";
type Sort = "number" | "rarity" | "name" | "price" | "count";

interface Prefs {
  filter: Filter;
  sort: Sort;
  rarity: string;
}

const PREFS_KEY = "pokemon-packs:album-prefs";
const defaultPrefs: Prefs = { filter: "all", sort: "number", rarity: "" };

function loadPrefs(): Prefs {
  try {
    return { ...defaultPrefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return { ...defaultPrefs };
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // nevadí
  }
}

const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
const VARIANT_SHORT: Record<Variant, string> = { normal: "", reverse: "RH", pokeball: "PB", masterball: "MB" };

interface Owned {
  card: Card;
  counts: Partial<Record<Variant, number>>;
  total: number;
}

function ownedOf(cards: Card[]): Owned[] {
  return cards.map((card) => {
    const counts = countsFor(card.id);
    const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
    return { card, counts, total };
  });
}

/** Hodnota všech vlastněných kusů (včetně duplikátů). */
function collectionValue(owned: Owned[], prices: Record<string, CardPrice>): PriceTotal {
  const total: PriceTotal = {};
  for (const o of owned) {
    for (const [variant, n] of Object.entries(o.counts) as [Variant, number][]) {
      addPrice(total, variantPrice(prices[o.card.id], variant), n);
    }
  }
  return total;
}

/** Provedení, které ukazuje dlaždice v albu (reverse / vzorované holo má přednost před normálním); podle něj i cena. */
const shownVariant = (o: Owned): Variant => (Object.keys(o.counts) as Variant[]).find((v) => v !== "normal") ?? "normal";

const priceIds = (cards: Card[]) => [...new Set(cards.map((c) => setIdOfCard(c.id)))];

function stats(owned: Owned[]) {
  const unique = owned.filter((o) => o.total > 0).length;
  const dupeCards = owned.filter((o) => o.total > 1).length;
  const extra = owned.reduce((n, o) => n + Math.max(0, o.total - 1), 0);
  const copies = owned.reduce((n, o) => n + o.total, 0);
  return { unique, dupeCards, extra, copies, total: owned.length };
}

// --- Statistiky přehledu jen ze sbírky ------------------------------------------
// Přehled alba dřív načítal karty všech sad (24 souborů, ~1,5 MB), jen aby spočítal
// kompletnost. Stačí ale sbírka (klíče „id karty|provedení“) a počty karet ze sets.json.

interface SetSummary {
  set: SetInfo;
  unique: number;
  dupeCards: number;
  extra: number;
  copies: number;
  total: number;
}

function summarize(sets: SetInfo[]) {
  const copiesById = new Map<string, number>();
  const entries: { id: string; variant: Variant; n: number }[] = [];
  for (const [key, n] of Object.entries(getState().collection)) {
    const cut = key.lastIndexOf("|");
    const id = key.slice(0, cut);
    entries.push({ id, variant: key.slice(cut + 1) as Variant, n });
    copiesById.set(id, (copiesById.get(id) ?? 0) + n);
  }
  const perSet = new Map<string, SetSummary>(
    sets.map((set) => [set.id, { set, unique: 0, dupeCards: 0, extra: 0, copies: 0, total: set.total }]),
  );
  for (const [id, copies] of copiesById) {
    const owner = setOfCard(id, sets);
    const sum = owner && perSet.get(owner.id);
    if (!sum) continue;
    sum.unique++;
    sum.copies += copies;
    if (copies > 1) {
      sum.dupeCards++;
      sum.extra += copies - 1;
    }
  }
  return { perSet: [...perSet.values()], entries };
}

const sumStats = (list: SetSummary[]) =>
  list.reduce(
    (a, s) => ({
      unique: a.unique + s.unique,
      dupeCards: a.dupeCards + s.dupeCards,
      extra: a.extra + s.extra,
      copies: a.copies + s.copies,
      total: a.total + s.total,
    }),
    { unique: 0, dupeCards: 0, extra: 0, copies: 0, total: 0 },
  );

function progress(value: number) {
  return h("div", { class: "progress" }, h("div", { class: "progress__bar", style: `width: ${value * 100}%` }));
}

// --- Přehled všech sad -----------------------------------------------------

async function renderOverview(root: HTMLElement) {
  const sets = await loadSets();
  const { perSet, entries } = summarize(sets);
  const st = sumStats(perSet);
  const valueEl = h("strong", null, "…");
  const opened = Object.values(getState().opened).reduce((a, b) => a + b, 0);
  const godPacks = Object.values(getState().godPacks).reduce((a, b) => a + b, 0);

  root.append(
    h(
      "section",
      { class: "view-head view-head--row" },
      h("h1", null, t.album.title),
      h("a", { class: "btn", href: "#/stats" }, t.album.statsLink),
    ),
    h(
      "div",
      { class: "stats" },
      h("div", null, h("span", null, t.album.unique), h("strong", null, `${st.unique} / ${st.total}`)),
      h("div", null, h("span", null, t.album.copies), h("strong", null, String(st.copies))),
      h("div", null, h("span", null, t.album.dupes), h("strong", null, `${st.extra}`)),
      h("div", null, h("span", null, t.album.opened), h("strong", null, String(opened))),
      godPacks ? h("div", null, h("span", null, t.album.godPacks), h("strong", null, String(godPacks))) : null,
      h("div", { class: "stats__wide" }, h("span", null, t.album.collectionValue), valueEl),
    ),
    // Sady podle éry; otevřené jsou éry, ze kterých už něco máš (a nejnovější).
    ...groupBySeries(perSet, (p) => p.set.series).map(({ series, items }, i) => {
      const era = sumStats(items);
      return eraSection({
        view: "album",
        series,
        meta: t.album.eraMeta(era.unique, era.total, pct.format(era.unique / era.total)),
        defaultOpen: i === 0 || era.unique > 0,
        build: () =>
          h(
            "div",
            { class: "album-sets" },
            ...items.map((s) => {
              const { set } = s;
              return h(
                "a",
                { class: "album-set", href: `#/album/${set.id}` },
                h("img", { src: set.logo, alt: set.name, loading: "lazy" }),
                h("div", null, h("strong", null, set.name), h("span", { class: "muted" }, ` ${s.unique}/${s.total} · ${pct.format(s.unique / s.total)}`)),
                progress(s.unique / s.total),
                s.extra ? h("span", { class: "muted small" }, t.album.dupeCount(s.extra)) : null,
              );
            }),
          ),
      });
    }),
  );

  if (entries.length === 0) {
    valueEl.textContent = formatEur(0);
    return;
  }
  const prices = await loadSetPrices([...new Set(entries.map((e) => setIdOfCard(e.id)))]);
  const value: PriceTotal = {};
  for (const e of entries) addPrice(value, variantPrice(prices[e.id], e.variant), e.n);
  valueEl.textContent = formatTotal(value);
}

// --- Album jedné sady ------------------------------------------------------

function sortOwned(list: Owned[], sort: Sort, prices: Record<string, CardPrice>) {
  const byNumber = (a: Owned, b: Owned) =>
    (a.card.prefix ?? "").localeCompare(b.card.prefix ?? "") || a.card.number - b.card.number;
  const cmp: Record<Sort, (a: Owned, b: Owned) => number> = {
    number: byNumber,
    rarity: (a, b) => rarityInfo(b.card.rarity).rank - rarityInfo(a.card.rarity).rank || byNumber(a, b),
    name: (a, b) => a.card.name.localeCompare(b.card.name, "cs") || byNumber(a, b),
    price: (a, b) =>
      sortValue(variantPrice(prices[b.card.id], shownVariant(b))) - sortValue(variantPrice(prices[a.card.id], shownVariant(a))) ||
      byNumber(a, b),
    count: (a, b) => b.total - a.total || byNumber(a, b),
  };
  return [...list].sort(cmp[sort]);
}

function tile(o: Owned, set: SetInfo, prices: Record<string, CardPrice>): HTMLElement {
  const info = rarityInfo(o.card.rarity);
  const variants = (Object.keys(o.counts) as Variant[]).filter((v) => v !== "normal");
  const shown = shownVariant(o);
  const price = variantPrice(prices[o.card.id], shown);
  return h(
    "button",
    { class: `album-tile${o.total ? "" : " album-tile--missing"}`, onclick: () => openCardModal(o.card, set) },
    cardEl(o.card, shown, { missing: o.total === 0, tilt: true, gyro: false }),
    o.total > 1 ? h("span", { class: "count-badge", title: t.album.dupeCount(o.total - 1) }, `×${o.total}`) : null,
    h(
      "div",
      { class: "album-tile__meta" },
      h("span", { class: "rarity-chip", style: `--rc: ${info.color}` }, info.short),
      h("span", null, `#${cardNumber(o.card)}`),
      ...variants.map((v) => h("span", { class: "variant-chip" }, VARIANT_SHORT[v])),
      price.eur !== undefined || price.usd !== undefined
        ? h("span", { class: "album-tile__price" }, price.eur !== undefined ? formatEur(price.eur) : formatUsd(price.usd))
        : null,
    ),
  );
}

function select<T extends string>(label: string, value: T, options: [T, string][], onChange: (v: T) => void) {
  const el = h(
    "select",
    { "aria-label": label, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value as T) },
    ...options.map(([v, text]) => h("option", { value: v, selected: v === value }, text)),
  );
  return h("label", { class: "field" }, h("span", null, label), el);
}

async function renderSetAlbum(root: HTMLElement, setId: string) {
  const sets = await loadSets();
  const set = sets.find((s) => s.id === setId);
  if (!set) {
    root.append(h("p", { class: "empty" }, t.common.unknownSet));
    return;
  }
  const cards = await loadCards(set.id);
  const owned = ownedOf(cards);
  const st = stats(owned);
  const prefs = loadPrefs();
  let query = "";
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let prices: Record<string, CardPrice> = {};

  const valueEl = h("strong", null, "…");
  const grid = h("div", { class: "album-grid" });
  const countEl = h("span", { class: "muted" });

  const rarities = [...new Set(cards.map((c) => c.rarity))].sort(
    (a, b) => (RARITIES[a]?.rank ?? 0) - (RARITIES[b]?.rank ?? 0),
  );

  if (!rarities.includes(prefs.rarity)) prefs.rarity = "";

  const render = () => {
    savePrefs(prefs);
    const q = query.trim().toLowerCase();
    const list = owned.filter((o) => {
      if (prefs.rarity && o.card.rarity !== prefs.rarity) return false;
      if (prefs.filter === "owned" && o.total === 0) return false;
      if (prefs.filter === "missing" && o.total > 0) return false;
      if (prefs.filter === "dupes" && o.total < 2) return false;
      if (q && !o.card.name.toLowerCase().includes(q) && cardNumber(o.card).toLowerCase() !== q) return false;
      return true;
    });
    countEl.textContent = t.album.count(list.length);
    grid.replaceChildren(...sortOwned(list, prefs.sort, prices).map((o) => tile(o, set, prices)));
    if (list.length === 0) grid.append(h("p", { class: "empty" }, t.album.noMatch));
  };

  root.append(
    h(
      "section",
      { class: "album-head" },
      h("a", { class: "back", href: "#/album" }, t.album.allSets),
      h("img", { class: "album-head__logo", src: set.logo, alt: set.name }),
      h(
        "div",
        { class: "stats" },
        h("div", null, h("span", null, t.album.collected), h("strong", null, `${st.unique} / ${st.total} (${pct.format(st.unique / st.total)})`)),
        h("div", null, h("span", null, t.album.dupes), h("strong", null, t.album.dupeDetail(st.dupeCards, st.extra))),
        h("div", null, h("span", null, t.album.opened), h("strong", null, String(getState().opened[set.id] ?? 0))),
        getState().godPacks[set.id]
          ? h("div", null, h("span", null, t.album.godPacks), h("strong", null, String(getState().godPacks[set.id])))
          : null,
        h("div", null, h("span", null, t.album.value), valueEl),
      ),
      progress(st.unique / st.total),
    ),
    h(
      "div",
      { class: "toolbar" },
      h(
        "label",
        { class: "field field--grow" },
        h("span", null, t.album.search),
        h("input", {
          type: "search",
          placeholder: t.album.searchPlaceholder,
          // Překreslení stovek karet až po krátké pauze v psaní, ne po každém písmenu.
          oninput: (e: Event) => {
            query = (e.target as HTMLInputElement).value;
            clearTimeout(searchTimer);
            searchTimer = setTimeout(render, 160);
          },
        }),
      ),
      select<Filter>(
        t.album.show,
        prefs.filter,
        [
          ["all", t.album.filter.all],
          ["owned", t.album.filter.owned],
          ["missing", t.album.filter.missing],
          ["dupes", t.album.filter.dupes],
        ],
        (v) => {
          prefs.filter = v;
          render();
        },
      ),
      select<string>(t.album.rarity, prefs.rarity, [["", t.album.allRarities], ...rarities.map((r): [string, string] => [r, r])], (v) => {
        prefs.rarity = v;
        render();
      }),
      select<Sort>(
        t.album.sort,
        prefs.sort,
        [
          ["number", t.album.sortBy.number],
          ["rarity", t.album.sortBy.rarity],
          ["name", t.album.sortBy.name],
          ["price", t.album.sortBy.price],
          ["count", t.album.sortBy.count],
        ],
        (v) => {
          prefs.sort = v;
          render();
        },
      ),
      countEl,
    ),
    grid,
  );
  render();

  prices = await loadSetPrices(priceIds(cards));
  valueEl.textContent = st.unique ? formatTotal(collectionValue(owned, prices)) : formatEur(0);
  if (grid.isConnected) render();
}

export async function renderAlbum(root: HTMLElement, setId?: string) {
  return setId ? renderSetAlbum(root, setId) : renderOverview(root);
}
