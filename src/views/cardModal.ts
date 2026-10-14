import { cardNumber, setIdOfCard } from "../data";
import { locale, t } from "../i18n";
import { rarityInfo, VARIANT_LABEL } from "../odds";
import { type CardPrice, formatEur, formatUsd, loadSetPrices, tcgdexPrice } from "../prices";
import { countsFor, getState } from "../store";
import type { Card, SetInfo, Variant } from "../types";
import { h } from "../ui/dom";
import { card3dViewer } from "../ui/card3d";
import { closeOnBack, trapFocus } from "../ui/history";
import { openModal } from "../ui/modal";

const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

function priceBlock(price: CardPrice | undefined): HTMLElement {
  if (!price || (price.eur === undefined && price.usd === undefined)) {
    return h("p", { class: "muted" }, t.card.noPrice);
  }
  const row = (label: string, value: string) => h("tr", null, h("th", null, label), h("td", null, value));
  return h(
    "div",
    null,
    h(
      "table",
      { class: "prices" },
      h(
        "tbody",
        null,
        row("Cardmarket (trend)", formatEur(price.eur)),
        price.eurReverse !== undefined ? row("Cardmarket reverse holo", formatEur(price.eurReverse)) : null,
        row("TCGplayer (market)", formatUsd(price.usd)),
        price.usdReverse !== undefined ? row("TCGplayer reverse holo", formatUsd(price.usdReverse)) : null,
      ),
    ),
    h(
      "p",
      { class: "muted small" },
      t.card.source(price.source, price.updated),
      price.cardmarketUrl ? h("a", { href: price.cardmarketUrl, target: "_blank", rel: "noopener" }, "Cardmarket") : null,
      price.cardmarketUrl && price.tcgplayerUrl ? " · " : null,
      price.tcgplayerUrl ? h("a", { href: price.tcgplayerUrl, target: "_blank", rel: "noopener" }, "TCGplayer") : null,
    ),
  );
}

/** Karta ve 3D přes celou obrazovku. */
function openFullscreen(card: Card, variant: Variant, missing: boolean) {
  const viewer = card3dViewer(card, variant, { missing });
  let closed = false;
  const finish = () => {
    if (closed) return false;
    closed = true;
    overlay.remove();
    document.removeEventListener("keydown", onKey, { capture: true });
    window.removeEventListener("hashchange", close);
    return true;
  };
  // Zpět zavře jen celou obrazovku, detail karty pod ní zůstane.
  const releaseHistory = closeOnBack(finish);
  const close = () => {
    if (finish()) releaseHistory();
  };
  // Esc a Tab patří jen tomuto oknu, ne detailu karty pod ním.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopImmediatePropagation();
      close();
    } else if (e.key === "Tab") {
      e.stopImmediatePropagation();
      focusTrap(e);
    }
  };
  const overlay = h(
    "div",
    { class: "viewer", role: "dialog", "aria-modal": "true", "aria-label": t.card.in3d(card.name) },
    h("h2", { class: "viewer__title" }, card.name),
    viewer.el,
    h(
      "div",
      { class: "card3d-controls" },
      h("button", { class: "btn", onclick: () => viewer.flip() }, t.card.flip),
      h("button", { class: "btn", onclick: () => viewer.reset() }, t.card.resetView),
      h("button", { class: "btn btn--primary", onclick: close }, t.common.close),
    ),
  );
  const focusTrap = trapFocus(overlay);
  // Esc zavře nejdřív celou obrazovku, ne detail karty pod ní.
  document.addEventListener("keydown", onKey, { capture: true });
  // přechod na jinou obrazovku zavře i celoobrazovkový prohlížeč
  window.addEventListener("hashchange", close);
  document.body.append(overlay);
}

export function openCardModal(card: Card, set: SetInfo) {
  const info = rarityInfo(card.rarity);
  const counts = countsFor(card.id);
  const owned = Object.entries(counts) as [Variant, number][];
  const total = owned.reduce((n, [, c]) => n + c, 0);
  const firstSeen = getState().firstSeen[card.id];
  const priceSlot = h("div", null, h("p", { class: "muted" }, t.card.loadingPrices));

  // Ve 3D ukážeme nejlepší vlastněné provedení (reverse / vzorované holo má přednost).
  const variant = owned.find(([v]) => v !== "normal")?.[0] ?? "normal";
  const viewer = card3dViewer(card, variant, { missing: total === 0 });

  const content = h(
    "div",
    { class: "card-detail" },
    h(
      "div",
      { class: "card-detail__card" },
      viewer.el,
      h(
        "div",
        { class: "card3d-controls" },
        h("button", { class: "btn", onclick: () => viewer.flip() }, t.card.flip),
        h("button", { class: "btn", onclick: () => viewer.reset() }, t.card.resetView),
        h("button", { class: "btn", onclick: () => openFullscreen(card, variant, total === 0) }, t.card.fullscreen),
      ),
      h("p", { class: "card3d-hint muted" }, t.card.hint3d),
    ),
    h(
      "div",
      { class: "card-detail__info" },
      h("h2", null, card.name),
      h(
        "p",
        null,
        h("span", { class: "rarity-dot", style: `background: ${info.color}` }),
        ` ${card.rarity}${card.printedRarity ? t.card.printedAs(card.printedRarity) : ""}`,
      ),
      h(
        "p",
        { class: "muted" },
        t.card.number(set.name, `${cardNumber(card)}${card.prefix ? "" : `/${set.printedTotal}`}`),
        card.artist ? t.card.illustrator(card.artist) : "",
      ),
      h(
        "p",
        { class: "muted" },
        [card.supertype, ...card.subtypes].join(" · "),
        card.hp ? ` · ${card.hp} HP` : "",
        card.types.length ? ` · ${card.types.join(", ")}` : "",
      ),
      h("h3", null, t.card.inCollection),
      total
        ? h(
            "ul",
            { class: "owned-list" },
            ...owned.map(([v, c]) => h("li", null, `${VARIANT_LABEL[v]}: ${c}×`)),
            h("li", null, h("strong", null, t.card.total(total)), total > 1 ? t.card.dupes(total - 1) : ""),
          )
        : h("p", { class: "muted" }, t.card.notOwned),
      firstSeen ? h("p", { class: "muted small" }, t.card.firstSeen(dateFmt.format(firstSeen))) : null,
      h("h3", null, t.card.marketPrice),
      priceSlot,
    ),
  );
  openModal(content, "modal__box--card");

  // Nejdřív ukážeme uložené ceny, pak je zkusíme nahradit živými z TCGdex.
  loadSetPrices([setIdOfCard(card.id)])
    .then(async (prices) => {
      const stored = prices[card.id];
      if (stored) priceSlot.replaceChildren(priceBlock(stored));
      const subsetName = card.prefix ? `${set.name}: ${card.rarity}` : set.name;
      const live = await tcgdexPrice(card, subsetName);
      const hasValue = (p?: CardPrice) => p && (p.eur !== undefined || p.usd !== undefined);
      priceSlot.replaceChildren(priceBlock(hasValue(live) ? { ...stored, ...live } : stored));
    })
    .catch(() => priceSlot.replaceChildren(priceBlock(undefined)));
}
