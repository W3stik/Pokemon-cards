// Přehled otevřeného balíčku (nebo více balíčků naráz): karty, nové do sbírky, hodnota.
import { t } from "../i18n";
import { rarityInfo, VARIANT_LABEL } from "../odds";
import { addPrice, type CardPrice, formatEur, formatTotal, formatUsd, loadSetPrices, type PriceTotal, variantPrice } from "../prices";
import { setIdOfCard } from "../data";
import { collectionKey } from "../store";
import type { PulledCard, SetInfo } from "../types";
import { clear, h } from "../ui/dom";
import { cardEl } from "../ui/holo";
import { unlockAudio } from "../ui/sfx";
import { openCardModal } from "./cardModal";

export interface SummaryContext {
  stage: HTMLElement;
  controls: HTMLElement;
  set: SetInfo;
  /** Přehrávání god packu ze Síně slávy: karty se do sbírky nepřidávají. */
  replay: boolean;
  /** Kolik balíčků sady ještě zbývá. */
  left(): number;
  /** Další balíček (nebo znovu přehrát). */
  next(): void;
  setKeys(handler: (e: KeyboardEvent) => boolean): void;
}

const priceSetIds = (cards: PulledCard[]) => [...new Set(cards.map((c) => setIdOfCard(c.card.id)))];

export function showSummary(ctx: SummaryContext, cards: PulledCard[], fresh: Set<string>, packs: number, godPacks: number) {
  clear(ctx.stage);
  clear(ctx.controls);

  // Stejné karty ve stejném provedení se seskupí (×N). U jednoho balíčku
  // zůstává pořadí, v jakém karty padly, u více balíčků řadíme od nejvzácnější.
  const groups = new Map<string, { pulled: PulledCard; count: number }>();
  for (const pulled of cards) {
    const key = collectionKey(pulled.card.id, pulled.variant);
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { pulled, count: 1 });
  }
  const entries = [...groups.values()];
  if (packs > 1) {
    entries.sort(
      (a, b) =>
        rarityInfo(b.pulled.card.rarity).rank - rarityInfo(a.pulled.card.rarity).rank ||
        a.pulled.card.number - b.pulled.card.number,
    );
  }
  const hits = entries.filter((e) => rarityInfo(e.pulled.card.rarity).hit);

  const total = h("strong", null, t.summary.loadingPrices);
  const grid = h("div", { class: "summary__grid" });
  let prices: Record<string, CardPrice> | null = null;
  let priceEls: { el: HTMLElement; pulled: PulledCard }[] = [];

  const priceText = (pulled: PulledCard) => {
    if (!prices) return "";
    const p = variantPrice(prices[pulled.card.id], pulled.variant);
    return p.eur !== undefined ? formatEur(p.eur) : p.usd !== undefined ? formatUsd(p.usd) : "";
  };

  const tile = ({ pulled, count }: { pulled: PulledCard; count: number }) => {
    const price = h("span", { class: "summary__price" }, priceText(pulled));
    priceEls.push({ el: price, pulled });
    return h(
      "button",
      { class: "summary__item", onclick: () => openCardModal(pulled.card, ctx.set) },
      cardEl(pulled.card, pulled.variant),
      count > 1 ? h("span", { class: "count-badge" }, `×${count}`) : null,
      h(
        "div",
        { class: "summary__meta" },
        h("span", { class: "rarity-chip", style: `--rc: ${rarityInfo(pulled.card.rarity).color}` }, rarityInfo(pulled.card.rarity).short),
        fresh.has(collectionKey(pulled.card.id, pulled.variant)) ? h("span", { class: "badge badge--new" }, t.common.newCard) : null,
        pulled.variant !== "normal" ? h("span", { class: "badge" }, VARIANT_LABEL[pulled.variant]) : null,
        price,
      ),
    );
  };

  let showAll = packs === 1;
  const toggle = h("button", { class: "btn btn--ghost" });
  const renderGrid = () => {
    const list = showAll ? entries : hits;
    priceEls = [];
    grid.replaceChildren(...list.map(tile));
    if (list.length === 0) grid.append(h("p", { class: "muted" }, t.summary.noHits));
    toggle.textContent = showAll ? t.summary.onlyHits : t.summary.showAll(entries.length);
  };
  toggle.addEventListener("click", () => {
    showAll = !showAll;
    renderGrid();
  });
  renderGrid();

  ctx.stage.append(
    h(
      "div",
      { class: `summary${godPacks ? " summary--god" : ""}` },
      h(
        "div",
        { class: "summary__head" },
        h("h2", null, packs > 1 ? t.summary.openedPacks(packs) : godPacks ? "GOD PACK!" : t.summary.yourPack),
        packs > 1 && godPacks ? h("p", { class: "summary__god" }, t.summary.godInPacks(godPacks)) : null,
        ctx.replay
          ? h("p", { class: "muted" }, t.summary.replayNote, total)
          : h("p", null, t.summary.result(cards.length, fresh.size), total),
        packs > 1 ? h("div", { class: "row" }, h("span", { class: "muted" }, t.summary.hits(hits.reduce((n, e) => n + e.count, 0))), toggle) : null,
      ),
      grid,
    ),
  );

  ctx.setKeys((e) => {
    if (e.key !== "Enter" || ctx.left() === 0) return false;
    unlockAudio();
    ctx.next();
    return true;
  });
  const next = () => (unlockAudio(), ctx.next());
  ctx.controls.append(
    ctx.replay
      ? h("button", { class: "btn btn--primary", onclick: next }, t.summary.replayAgain)
      : ctx.left() > 0
        ? h("button", { class: "btn btn--primary", onclick: next }, t.summary.openNext(ctx.left()))
        : h("a", { class: "btn btn--primary", href: "#/shop" }, t.summary.getMorePacks),
    ctx.replay
      ? h("a", { class: "btn", href: "#/stats" }, t.common.backToHall)
      : h("a", { class: "btn", href: `#/album/${ctx.set.id}` }, t.common.toAlbum),
  );

  loadSetPrices(priceSetIds(cards)).then((loaded) => {
    prices = loaded;
    const sum: PriceTotal = {};
    for (const pulled of cards) addPrice(sum, variantPrice(loaded[pulled.card.id], pulled.variant));
    total.textContent = formatTotal(sum, true);
    for (const { el, pulled } of priceEls) el.textContent = priceText(pulled);
  });
}
