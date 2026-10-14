// Balík karet po roztržení balíčku: karty se odhazují klepnutím, tažením nebo klávesnicí,
// vzácné leží rubem nahoru a odhalí se nabitím a otočením (efekty v src/ui/reveal.ts).
import { t } from "../i18n";
import { rarityInfo, VARIANT_LABEL } from "../odds";
import { isGodPack } from "../pack";
import { collectionKey } from "../store";
import type { PulledCard } from "../types";
import { clear, h, prefersReducedMotion, sleep } from "../ui/dom";
import { cardBack, cardEl, enableTilt } from "../ui/holo";
import { CHARGE_MS, flash, goldRain, rarityBanner, rays, shake, shockwave, stars, tierOf } from "../ui/reveal";
import { sfxCharge, sfxDeal, sfxFlip, sfxGodPack, sfxHit, sfxSwipe, unlockAudio } from "../ui/sfx";

export interface PileContext {
  stage: HTMLElement;
  controls: HTMLElement;
  /** Nastaví, co dělají klávesy (Enter / mezerník / šipky). */
  setKeys(handler: (e: KeyboardEvent) => boolean): void;
  /** Všechny karty jsou odhozené, nebo hráč přeskočil: přehled. */
  done(): void;
}

export function showPile(ctx: PileContext, cards: PulledCard[], fresh: Set<string>) {
  const { stage } = ctx;
  clear(stage);
  const counter = h("div", { class: "stage__counter" });
  const stack = h("div", { class: "pile__stack" });
  const pile = h("div", { class: "pile" }, stack);
  enableTilt(pile);
  stage.append(pile, counter, h("p", { class: "stage__hint" }, t.open.pileHint));
  // God pack se předem neprozradí: zlatá záře a nápis až po odhalení poslední karty.
  const god = isGodPack(cards);
  let godAnnounced = false;
  const announceGod = async () => {
    if (!god || godAnnounced) return;
    godAnnounced = true;
    // nejdřív dozní efekty poslední karty
    await sleep(1100);
    if (!pile.isConnected) return;
    pile.classList.add("pile--god");
    godBanner(stage);
  };

  // Vzácné karty leží rubem nahoru a odhalí se až klepnutím (nabití a otočení).
  // S omezenými animacemi se ukazují rovnou lícem.
  const faceDown = !prefersReducedMotion();
  const items = cards.map((pulled, i) => {
    const info = rarityInfo(pulled.card.rarity);
    const front = cardEl(pulled.card, pulled.variant, { tilt: true });
    const isNew = fresh.has(collectionKey(pulled.card.id, pulled.variant));
    // Karty v balíčku nejsou srovnané úplně přesně: lehké pootočení a hloubka.
    const rot = ((i * 37) % 7) - 3;
    const item = h(
      "div",
      {
        class: `pile__item${info.hit ? " is-hit" : ""}${info.hit && faceDown ? " is-facedown" : ""} tier-${tierOf(info.rank)}`,
        style: `--rc: ${info.color}; --i: ${i}; --z: ${-i * 3}px; --rot: ${rot * 0.6}deg; z-index: ${cards.length - i}`,
        dataset: { rarity: pulled.card.rarity },
      },
      h(
        "div",
        { class: "flip" },
        h("div", { class: "flip__front" }, front),
        h("div", { class: "flip__back" }, cardBack()),
      ),
      h(
        "div",
        { class: "pile__tag" },
        isNew ? h("span", { class: "badge badge--new" }, t.common.newCard) : null,
        pulled.variant !== "normal" ? h("span", { class: "badge" }, VARIANT_LABEL[pulled.variant]) : null,
        info.hit ? h("span", { class: "badge", style: `background: ${info.color}; color: #111` }, pulled.card.rarity) : null,
      ),
    );
    stack.append(item);
    return item;
  });
  sfxDeal(cards.length);

  let index = 0;
  let busy = false;
  const update = () => {
    counter.textContent = `${Math.min(index + 1, cards.length)} / ${cards.length}`;
    items.forEach((item, i) => item.classList.toggle("is-current", i === index));
    // Napětí: rub vzácné karty září barvou rarity (silněji u vzácnějších).
    const current = items[index];
    const tease = current?.classList.contains("is-facedown");
    pile.classList.toggle("pile--tease", Boolean(tease));
    for (const t of [1, 2, 3, 4]) pile.classList.toggle(`pile--tier-${t}`, Boolean(tease) && tierOf(rarityInfo(cards[index].card.rarity).rank) === t);
    if (tease) pile.style.setProperty("--tease", rarityInfo(cards[index].card.rarity).color);
    // s omezenými animacemi leží karty lícem: god pack se ohlásí u poslední karty
    if (index === items.length - 1 && current && !tease) announceGod();
  };
  update();

  /** Odhalení karty ležící rubem nahoru: nabití (zvedne se a chvěje), otočení a efekty. */
  const flipOver = async (item: HTMLElement) => {
    busy = true;
    const rank = rarityInfo(cards[index].card.rarity).rank;
    const tier = tierOf(rank);
    const ms = CHARGE_MS[tier];
    item.style.setProperty("--charge", `${ms}ms`);
    item.classList.add("is-charging");
    pile.classList.add("pile--charging");
    sfxCharge(tier, ms);
    await sleep(ms);
    item.classList.remove("is-charging");
    pile.classList.remove("pile--charging", "pile--tease");
    item.classList.remove("is-facedown");
    item.classList.add("is-flipping");
    sfxFlip();
    // líc se ukáže zhruba v polovině otočení – tehdy efekty
    await sleep(300);
    revealHit(stage, item, rank);
    await sleep(350);
    item.classList.remove("is-flipping");
    // poslední karta god packu: odhodit ji jde až po ohlášení
    if (index === items.length - 1) await announceGod();
    busy = false;
  };

  const throwAway = async (item: HTMLElement, dir: number) => {
    item.style.setProperty("--dir", String(dir));
    item.classList.add("is-gone");
    sfxSwipe(dir);
    index++;
    update();
    if (index >= items.length) {
      await sleep(300);
      ctx.done();
    }
  };

  const advance = async () => {
    if (busy) return;
    const item = items[index];
    if (!item) return;
    if (item.classList.contains("is-facedown")) return flipOver(item);
    busy = true;
    await throwAway(item, -1);
    busy = false;
  };

  // Odhozování karty tažením: karta se při tom naklání ve 3D.
  let drag: { x: number; item: HTMLElement } | null = null;
  let dx = 0;
  pile.addEventListener("pointerdown", (e) => {
    unlockAudio();
    const item = items[index];
    if (busy || !item) return;
    drag = { x: e.clientX, item };
    dx = 0;
    pile.setPointerCapture(e.pointerId);
  });
  pile.addEventListener("pointermove", (e) => {
    if (!drag) return;
    dx = e.clientX - drag.x;
    drag.item.classList.add("is-dragging");
    drag.item.style.transform = `translate3d(${dx}px, ${-Math.abs(dx) * 0.08}px, 40px) rotateY(${dx * 0.15}deg) rotateZ(${dx * 0.05}deg)`;
  });
  const release = () => {
    if (!drag) return;
    const { item } = drag;
    drag = null;
    item.classList.remove("is-dragging");
    item.style.transform = "";
    // kartu rubem nahoru nejde zahodit neodhalenou: tah ji otočí
    if (item.classList.contains("is-facedown")) {
      if (!busy && (Math.abs(dx) > 70 || Math.abs(dx) < 8)) flipOver(item);
    } else if (Math.abs(dx) > 70 && !busy) throwAway(item, Math.sign(dx));
    else if (Math.abs(dx) < 8) advance();
  };
  pile.addEventListener("pointerup", release);
  pile.addEventListener("pointercancel", release);
  ctx.setKeys((e) => {
    const item = items[index];
    if (!item || busy) return e.key === " " || e.key.startsWith("Arrow");
    if (e.key === "Enter" || e.key === " ") {
      advance();
      return true;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (item.classList.contains("is-facedown")) flipOver(item);
      else throwAway(item, e.key === "ArrowLeft" ? -1 : 1);
      return true;
    }
    return false;
  });

  ctx.controls.append(h("button", { class: "btn", onclick: () => ctx.done() }, t.open.skip));
}

/** Efekty odhalení vzácné karty podle úrovně rarity (src/ui/reveal.ts). */
function revealHit(stage: HTMLElement, item: HTMLElement, rank: number) {
  item.classList.add("is-revealed");
  sfxHit(rank);
  if (prefersReducedMotion()) return;
  const tier = tierOf(rank);
  const color = getComputedStyle(item).getPropertyValue("--rc").trim() || "#fff";
  const pile = item.closest<HTMLElement>(".pile");
  item.classList.add("is-pop");
  setTimeout(() => item.classList.remove("is-pop"), 800);
  shockwave(item, color, tier);
  stars(item, color, tier);
  if (tier >= 2 && pile) rays(pile, color, tier);
  if (tier >= 3) {
    stage.classList.add("stage--spotlight");
    setTimeout(() => stage.classList.remove("stage--spotlight"), 2400);
    const name = item.dataset.rarity ?? "";
    rarityBanner(stage, name, color, tier);
    flash(tier >= 4 ? "#ffd65a" : color);
  }
  if (tier >= 4) {
    goldRain(stage);
    if (pile) shake(pile);
  }
}

/** Nápis GOD PACK přes balík karet, s nejsilnější fanfárou a vibrací. */
function godBanner(stage: HTMLElement) {
  stage.querySelector(".rarity-banner")?.remove();
  const banner = h("div", { class: "god-banner", role: "status" }, "GOD PACK!");
  stage.append(banner);
  sfxGodPack();
  if (!prefersReducedMotion()) flash("#ffd65a");
  setTimeout(() => banner.remove(), 2600);
}
