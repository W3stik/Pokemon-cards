// Moje karty (#/cards): album naskenovaných skutečných karet s cenami. Karty jsou ze všech
// anglických sad (seznam ze skeneru, src/scan/db.ts), ceny živě z TCGdex (src/scan/cardInfo.ts).
import { t } from "../i18n";
import { addPrice, formatEur, formatTotal, formatUsd, type PriceTotal, variantPrice } from "../prices";
import { cachedInfo, cardInfo } from "../scan/cardInfo";
import { loadScanIndex, type ScanCard } from "../scan/db";
import { addReal, getState, realCounts, subscribe } from "../store";
import type { Variant } from "../types";
import { h } from "../ui/dom";
import { openModal } from "../ui/modal";
import { priceLabel } from "./scan";

type Sort = "set" | "name" | "price" | "count";
const VARIANTS: Variant[] = ["normal", "reverse"];

interface Owned {
  id: string;
  /** Karta ze seznamu skeneru; undefined = karta, kterou seznam (už) nezná. */
  card?: ScanCard;
  order: number;
  counts: Partial<Record<Variant, number>>;
  total: number;
}

function ownedCards(cards: ScanCard[], byId: Map<string, ScanCard>): Owned[] {
  const order = new Map(cards.map((c, i) => [c.id, i]));
  const map = new Map<string, Owned>();
  for (const [key, count] of Object.entries(getState().real)) {
    const id = key.slice(0, key.lastIndexOf("|"));
    const variant = key.slice(key.lastIndexOf("|") + 1) as Variant;
    const o = map.get(id) ?? { id, card: byId.get(id), order: order.get(id) ?? -1, counts: {}, total: 0 };
    o.counts[variant] = count;
    o.total += count;
    map.set(id, o);
  }
  return [...map.values()];
}

/** Hodnota všech kusů karty podle cen, které už jsou stažené. */
function ownedValue(o: Owned): PriceTotal {
  const total: PriceTotal = {};
  const price = cachedInfo(o.id)?.price;
  for (const [variant, count] of Object.entries(o.counts) as [Variant, number][]) addPrice(total, variantPrice(price, variant), count);
  return total;
}

function openDetail(o: Owned) {
  const name = o.card?.name ?? o.id;
  const rows = h("div", { class: "owned-list" });
  const render = () => {
    const counts = realCounts(o.id);
    const price = cachedInfo(o.id)?.price;
    rows.replaceChildren(
      ...VARIANTS.map((variant) => {
        const count = counts[variant] ?? 0;
        const p = variantPrice(price, variant);
        return h(
          "div",
          { class: "real-row" },
          h("span", null, variant === "normal" ? t.cards.normal : t.cards.reverse),
          h("span", { class: "muted small" }, [p.eur !== undefined ? formatEur(p.eur) : null, p.usd !== undefined ? formatUsd(p.usd) : null].filter(Boolean).join(" · ") || "–"),
          h("button", { class: "btn", disabled: count === 0, "aria-label": t.cards.less, onclick: () => addReal(o.id, variant, -1) }, "−"),
          h("strong", null, String(count)),
          h("button", { class: "btn", "aria-label": t.cards.more, onclick: () => addReal(o.id, variant) }, "+"),
        );
      }),
    );
  };
  render();
  cardInfo(o.id).then(() => rows.isConnected && render());
  const off = subscribe(() => (rows.isConnected ? render() : off()));
  openModal(
    h(
      "div",
      { class: "card-detail" },
      o.card ? h("img", { class: "real-detail__img", src: `${o.card.image}/high.webp`, alt: name }) : null,
      h(
        "div",
        { class: "card-detail__info" },
        h("h2", null, name),
        o.card ? h("p", { class: "muted" }, `${o.card.setName} · #${o.card.number}${o.card.year ? ` · ${o.card.year}` : ""}`) : null,
        rows,
      ),
    ),
  );
}

export async function renderCards(root: HTMLElement) {
  const valueEl = h("strong", null, "…");
  const uniqueEl = h("strong");
  const piecesEl = h("strong");
  const grid = h("div", { class: "album-grid" });
  let query = "";
  let sort: Sort = "set";

  const search = h("input", { type: "search", placeholder: t.album.searchPlaceholder, "aria-label": t.album.search });
  const sortSelect = h(
    "select",
    { "aria-label": t.album.sort },
    ...(
      [
        ["set", t.cards.sortSet],
        ["name", t.album.sortBy.name],
        ["price", t.album.sortBy.price],
        ["count", t.album.sortBy.count],
      ] as [Sort, string][]
    ).map(([value, label]) => h("option", { value }, label)),
  );

  root.append(
    h("div", { class: "view-head view-head--row" }, h("h1", null, t.cards.title), h("a", { class: "btn btn--primary", href: "#/scan" }, t.cards.scan)),
    h(
      "div",
      { class: "stats" },
      h("div", null, h("span", null, t.album.unique), uniqueEl),
      h("div", null, h("span", null, t.album.copies), piecesEl),
      h("div", { class: "stats__wide" }, h("span", null, t.album.collectionValue), valueEl),
    ),
    h(
      "div",
      { class: "toolbar" },
      h("label", { class: "field field--grow" }, h("span", null, t.album.search), search),
      h("label", { class: "field" }, h("span", null, t.album.sort), sortSelect),
    ),
    grid,
  );

  const index = await loadScanIndex();
  if (!root.isConnected) return;

  const unitPrice = (o: Owned) => {
    const p = variantPrice(cachedInfo(o.id)?.price, o.counts.normal ? "normal" : "reverse");
    return p.eur ?? p.usd ?? -1;
  };
  const render = () => {
    const owned = ownedCards(index.cards, index.byId);
    uniqueEl.textContent = String(owned.length);
    piecesEl.textContent = String(owned.reduce((a, o) => a + o.total, 0));
    const total: PriceTotal = {};
    for (const o of owned) {
      const v = ownedValue(o);
      addPrice(total, { eur: v.eur, usd: v.usd });
    }
    valueEl.textContent = owned.length ? formatTotal(total, true) : "–";

    const q = query.trim().toLowerCase();
    const list = owned.filter((o) => !q || `${o.card?.name ?? o.id} ${o.card?.setName ?? ""} ${o.card?.number ?? ""}`.toLowerCase().includes(q));
    list.sort(
      sort === "name"
        ? (a, b) => (a.card?.name ?? a.id).localeCompare(b.card?.name ?? b.id)
        : sort === "price"
          ? (a, b) => unitPrice(b) - unitPrice(a)
          : sort === "count"
            ? (a, b) => b.total - a.total
            : // nejnovější sady napřed, v sadě podle čísla
              (a, b) => (b.card?.year ?? 0) - (a.card?.year ?? 0) || a.order - b.order,
    );
    grid.replaceChildren(
      ...list.map((o) => {
        const variant: Variant = o.counts.normal ? "normal" : "reverse";
        return h(
          "button",
          { class: "album-tile real-tile", onclick: () => openDetail(o) },
          o.card
            ? h("img", { class: "real-tile__img", src: `${o.card.image}/low.webp`, alt: o.card.name, loading: "lazy", decoding: "async" })
            : h("div", { class: "real-tile__img real-tile__img--missing" }, "?"),
          o.total > 1 ? h("span", { class: "count-badge" }, `×${o.total}`) : null,
          h("span", { class: "real-tile__name" }, o.card?.name ?? o.id),
          h(
            "div",
            { class: "album-tile__meta" },
            h("span", null, o.card ? `${o.card.setName} #${o.card.number}` : ""),
            o.counts.reverse ? h("span", { class: "variant-chip" }, "RH") : null,
            h("span", { class: "album-tile__price" }, priceLabel(variantPrice(cachedInfo(o.id)?.price, variant))),
          ),
        );
      }),
    );
    if (owned.length === 0) grid.append(h("p", { class: "empty" }, t.cards.empty));
    else if (list.length === 0) grid.append(h("p", { class: "empty" }, t.album.noMatch));
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => root.isConnected && render(), 160);
  };
  search.addEventListener("input", () => {
    query = search.value;
    later();
  });
  sortSelect.addEventListener("change", () => {
    sort = sortSelect.value as Sort;
    render();
  });
  const off = subscribe(() => (root.isConnected ? later() : off()));

  render();
  // ceny: z mezipaměti hned, čerstvé postupně z TCGdex
  for (const o of ownedCards(index.cards, index.byId)) cardInfo(o.id).then(() => root.isConnected && later());
}
