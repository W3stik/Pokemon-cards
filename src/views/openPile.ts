// Balík karet po roztržení balíčku: karty vyjedou z obalu (3D model leží nad balíkem
// a zakrývá jeho spodek, pak sjede dolů). Horní karta sleduje prst (natočení podle místa
// úchopu) a odletí švihem nebo odtažením; klepnutí ji odhodí do strany. Vzácné karty jsou
// lícem nahoru: zpoza horní karty prosvítá barva rarity karty pod ní a efekty
// (src/ui/reveal.ts) přijdou, když se dostane nahoru.
import { setIdOfCard } from "../data";
import { t } from "../i18n";
import { rarityInfo, VARIANT_LABEL } from "../odds";
import { isGodPack } from "../pack";
import { addPrice, formatTotal, loadSetPrices, type PriceTotal, variantPrice } from "../prices";
import { collectionKey } from "../store";
import type { PulledCard } from "../types";
import { clear, h, prefersReducedMotion, sleep } from "../ui/dom";
import { cardEl, enableTilt } from "../ui/holo";
import { bokeh, flash, goldRain, rarityBanner, rays, shake, shockwave, stars, tierOf } from "../ui/reveal";
import { sfxCharge, sfxDeal, sfxGodPack, sfxHit, sfxSwipe, unlockAudio } from "../ui/sfx";
import { openCardViewer } from "./cardModal";

export interface PileContext {
  stage: HTMLElement;
  controls: HTMLElement;
  /** Nastaví, co dělají klávesy (Enter / mezerník / šipka nahoru). */
  setKeys(handler: (e: KeyboardEvent) => boolean): void;
  /** Všechny karty jsou v ruce a hráč pokračuje, nebo přeskočil: přehled. */
  done(): void;
  /** Místo pro hodnotu odhalených karet (horní řádek obrazovky). */
  value?: HTMLElement;
  /** Roztržený 3D obal, ze kterého karty vyjedou (bez WebGL chybí, karty pak vyjedou zespodu). */
  pack?: { el: HTMLElement; ratio: number; drop(): Promise<void>; light?: PackLight };
}

export interface PackLight {
  el: HTMLElement;
  tier: number;
}

/**
 * Světlo z roztrženého balíčku v barvě nejvzácnější karty (prozradí, co přijde, ale ne
 * co): bílé bez vzácné karty, jinak barva rarity a víc světla u vzácnějších. Rozsvítí se
 * hned při roztržení – vloží se do 3D obalu za plátno (spodek zakryje obal) – a při
 * vyjíždění karet svítí za nimi, dokud obal neodjede.
 */
export function packLight(model: HTMLElement, cards: PulledCard[]): PackLight {
  const best = cards.map((c) => rarityInfo(c.card.rarity)).reduce((a, b) => (b.rank > a.rank ? b : a));
  const tier = best.hit ? tierOf(best.rank) : 0;
  const el = h("div", {
    class: `pile__light pile__light--tier-${tier}`,
    style: `--lc: ${best.hit ? best.color : "#ffffff"}`,
  });
  model.prepend(el);
  if (!prefersReducedMotion()) {
    el.getBoundingClientRect(); // výchozí (zhasnutý) stav, ať se rozsvícení animuje
    el.classList.add("is-on");
    if (tier >= 2) sfxCharge(tier, 1100);
  }
  return { el, tier };
}

/** Řez pod horním zataveným okrajem a rezerva obdélníku 3D modelu (stejné jako v packModel.ts). */
const CUT_V = 0.095;
const PACK_HEIGHT = 0.84;

interface Pose {
  x: number;
  y: number;
  rot: number;
}
const transform = (p: Pose, z: number, scale = 1) =>
  `translate3d(${p.x}px, ${p.y}px, ${z}px) rotateZ(${p.rot}deg) scale(${scale})`;

export function showPile(ctx: PileContext, cards: PulledCard[], fresh: Set<string>) {
  const { stage } = ctx;
  // kde byl obal před roztržením (z té polohy a velikosti balík plynule přejede)
  const packFrom = ctx.pack?.el.isConnected ? ctx.pack.el.getBoundingClientRect() : null;
  clear(stage);
  const reduced = prefersReducedMotion();
  const fromPack = Boolean(ctx.pack) && !reduced;
  const counter = h("div", { class: "stage__counter" });
  const hint = h("p", { class: "stage__hint" });
  const stack = h("div", { class: "pile__stack" });
  const light = ctx.pack?.light;
  const pile = h("div", { class: `pile ${fromPack ? "pile--intro" : "pile--rise-in"}` }, stack);
  enableTilt(pile);
  // Hodnota odhalených karet: v horním řádku obrazovky, na pevném místě
  const valueAmount = h("strong", null, "…");
  const value = ctx.value ?? h("span", { class: "chip pile-value" });
  value.replaceChildren(h("span", null, t.open.packValue), valueAmount);
  value.classList.remove("hidden");
  stage.append(pile, counter, hint);
  if (!ctx.value) stage.prepend(value);

  // God pack se předem neprozradí: zlatá záře a nápis až po položení poslední karty.
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

  const n = cards.length;
  const items = cards.map((pulled, i) => {
    const info = rarityInfo(pulled.card.rarity);
    const isNew = fresh.has(collectionKey(pulled.card.id, pulled.variant));
    const item = h(
      "div",
      {
        class: `pile__item${info.hit ? " is-hit" : ""} tier-${tierOf(info.rank)}`,
        style: `--rc: ${info.color}; --i: ${i}`,
        dataset: { rarity: pulled.card.rarity },
      },
      h("div", { class: "flip" }, h("div", { class: "flip__front" }, cardEl(pulled.card, pulled.variant, { tilt: true }))),
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

  // Pořadí v ruce: vepředu karta, která je na řadě, pod ní další; odhozené jsou pryč.
  let index = 0;
  const layout = () => {
    items.forEach((item, i) => {
      const d = Math.max(0, i - index);
      item.style.setProperty("--z", `${-d * 3}px`);
      item.style.zIndex = String(n - d);
      item.classList.toggle("is-current", i === index);
    });
    counter.textContent = `${Math.min(index + 1, n)} / ${n}`;
    // napětí: zpoza horní karty prosvítá barva vzácné karty, která je pod ní
    const below = index + 1 < n ? rarityInfo(cards[index + 1].card.rarity) : null;
    const tease = Boolean(below?.hit);
    pile.classList.toggle("pile--tease", tease);
    for (const tier of [1, 2, 3, 4]) pile.classList.toggle(`pile--tier-${tier}`, tease && tierOf(below!.rank) === tier);
    if (below && tease) pile.style.setProperty("--tease", below.color);
  };
  layout();
  hint.textContent = t.open.pileHint;

  let busy = true;
  const width = () => pile.clientWidth || 1;
  const height = () => pile.clientHeight || 1;

  // Ceny karet; hodnota se přičítá, jak se karty dostávají nahoru.
  let prices: Awaited<ReturnType<typeof loadSetPrices>> | null = null;
  let shown = -1;
  const updateValue = (pop: boolean) => {
    if (!prices) return;
    const sum: PriceTotal = {};
    for (let i = 0; i <= Math.min(shown, n - 1); i++) addPrice(sum, variantPrice(prices[cards[i].card.id], cards[i].variant));
    valueAmount.textContent = shown < 0 ? "–" : formatTotal(sum);
    if (!pop || reduced) return;
    // dražší karta (aspoň 2 €/$): hodnota poskočí výrazněji
    const card = variantPrice(prices[cards[shown].card.id], cards[shown].variant);
    const big = (card.eur ?? card.usd ?? 0) >= 2;
    value.animate(
      [{ transform: `scale(${big ? 1.18 : 1.06})`, color: big ? "var(--accent)" : "inherit" }, { transform: "scale(1)" }],
      { duration: big ? 600 : 300, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.3)" },
    );
  };
  loadSetPrices([...new Set(cards.map((c) => setIdOfCard(c.card.id)))]).then((p) => {
    prices = p;
    // žádná karta cenu nemá: hodnota se neukazuje
    if (!cards.some((c) => p[c.card.id])) value.classList.add("hidden");
    updateValue(false);
  });

  /** Karta, která se právě dostala nahoru: u vzácné efekty, u poslední ohlášení god packu. */
  const revealCurrent = async () => {
    shown = index;
    updateValue(true);
    const info = rarityInfo(cards[index].card.rarity);
    if (info.hit) revealHit(stage, items[index], info.rank);
    if (index === n - 1) await announceGod();
  };

  /** Odhození horní karty: odletí z pózy, ve které je, směrem (dirX, dirY) a zmizí. */
  const throwAway = async (from: Pose, dirX: number, dirY: number) => {
    busy = true;
    const item = items[index];
    item.classList.add("is-pulled", "is-dragging");
    const len = Math.hypot(dirX, dirY) || 1;
    const ux = dirX / len;
    const uy = dirY / len;
    const far = 1.6 * Math.max(width(), height());
    const out: Pose = { x: from.x + ux * far, y: from.y + uy * far, rot: from.rot + (ux < 0 ? -28 : 28) };
    sfxSwipe(ux < 0 ? -1 : 1);
    const anim = reduced
      ? null
      : item.animate(
          [
            { transform: transform(from, 4, 1.02), opacity: 1 },
            { transform: transform(out, 40, 1.02), opacity: 0 },
          ],
          { duration: 300, easing: "cubic-bezier(0.3, 0.5, 0.6, 1)", fill: "forwards" },
        );
    index++;
    layout();
    await anim?.finished.catch(() => undefined);
    item.classList.add("is-gone");
    item.classList.remove("is-pulled");
    anim?.cancel();
    if (index >= n) {
      await sleep(200);
      ctx.done();
      return;
    }
    busy = false;
    await revealCurrent();
  };

  /** Klepnutí / klávesa: horní karta odletí do strany. */
  const advance = (dir = -1) => {
    if (busy || index >= n) return;
    throwAway({ x: 0, y: 0, rot: 0 }, dir, -0.25);
  };

  // Tah prstem: horní karta se drží tam, kde jsi ji chytil, a natáčí se podle místa úchopu.
  let drag: {
    item: HTMLElement;
    x0: number;
    y0: number;
    grabY: number;
    moved: boolean;
    pose: Pose;
    samples: { x: number; y: number; t: number }[];
  } | null = null;
  // Podržení (bez pohybu) otevře horní kartu ve 3D přes celou obrazovku.
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelHold = () => {
    clearTimeout(holdTimer);
    items[index]?.classList.remove("is-holding");
  };
  pile.addEventListener("pointerdown", (e) => {
    unlockAudio();
    if (busy || index >= n) return;
    cancelHold();
    const held = index;
    items[held].classList.add("is-holding");
    holdTimer = setTimeout(() => {
      items[held].classList.remove("is-holding");
      if (!drag || drag.moved || index !== held) return;
      drag = null;
      openCardViewer(cards[held].card, cards[held].variant);
    }, 450);
    const r = pile.getBoundingClientRect();
    drag = {
      item: items[index],
      x0: e.clientX,
      y0: e.clientY,
      grabY: (e.clientY - r.top) / r.height - 0.5,
      moved: false,
      pose: { x: 0, y: 0, rot: 0 },
      samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }],
    };
    pile.setPointerCapture(e.pointerId);
  });
  pile.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      cancelHold();
      drag.item.classList.add("is-pulled", "is-dragging");
      // pod kartou čeká vzácná: záře se při tahu rozhoří
      if (pile.classList.contains("pile--tease")) pile.classList.add("pile--pulling");
    }
    const now = performance.now();
    drag.samples.push({ x: e.clientX, y: e.clientY, t: now });
    while (drag.samples.length > 2 && now - drag.samples[0].t > 90) drag.samples.shift();
    // chycená nad středem se při tahu do strany natáčí jedním směrem, pod středem druhým
    const rot = Math.max(-25, Math.min(25, (dx / width()) * 20 * (drag.grabY < 0 ? 1 : -1)));
    drag.pose = { x: dx, y: dy, rot };
    drag.item.style.transform = transform(drag.pose, 4, 1.02);
  });
  const release = () => {
    cancelHold();
    if (!drag) return;
    const d = drag;
    drag = null;
    pile.classList.remove("pile--pulling");
    if (!d.moved) {
      advance();
      return;
    }
    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const dt = Math.max(1, last.t - first.t);
    const vx = (last.x - first.x) / dt;
    const vy = (last.y - first.y) / dt;
    const moved = Math.max(Math.abs(d.pose.x) / width(), Math.abs(d.pose.y) / height());
    // odletí švihem (směr švihu), nebo když je odtažená aspoň o třetinu (směr tahu)
    if (Math.hypot(vx, vy) > 0.5) throwAway(d.pose, vx, vy);
    else if (moved >= 0.35) throwAway(d.pose, d.pose.x, d.pose.y);
    else {
      // málo: vrátí se na balík
      d.item.classList.remove("is-dragging", "is-pulled");
      d.item.style.transform = "";
    }
  };
  pile.addEventListener("pointerup", release);
  pile.addEventListener("pointercancel", release);
  ctx.setKeys((e) => {
    if (e.key === "Enter" || e.key === " ") advance(-1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") advance(e.key === "ArrowLeft" ? -1 : 1);
    else return false;
    return true;
  });
  ctx.controls.append(h("button", { class: "btn", onclick: () => ctx.done() }, t.open.skip));

  // Úvod: karty vyjedou z roztrženého obalu, obal sjede dolů (bez WebGL vyjedou zespodu).
  const intro = async () => {
    sfxDeal(n);
    if (ctx.pack && fromPack) {
      // Obal o něco širší než karty, řez kousek nad horním okrajem karet (karty jsou uvnitř).
      const w = width();
      const hgt = height();
      const boxW = ((w / 0.82) * 0.62) / (PACK_HEIGHT * ctx.pack.ratio);
      const boxH = boxW / 0.62;
      const cutY = boxH * ((1 - PACK_HEIGHT) / 2 + CUT_V * PACK_HEIGHT);
      const wrap = h("div", {
        class: "pile__pack",
        style: `width: ${boxW}px; height: ${boxH}px; left: ${(w - boxW) / 2}px; top: ${0.06 * hgt - cutY}px`,
      });
      wrap.append(ctx.pack.el);
      pile.append(wrap);
      // Světlo z obalu přejde za karty (ve stejném místě nad trhlinou), ať jim nesvítí přes líc.
      if (light) {
        light.el.classList.add("pile__light--in-pile");
        light.el.style.cssText += `; left: ${(w - boxW) / 2 - 0.45 * boxW}px; width: ${1.9 * boxW}px; height: ${0.75 * boxH}px; top: ${0.06 * hgt - 0.75 * boxH}px`;
        pile.prepend(light.el);
      }
      // Obal je teď jinde a větší než před roztržením: celý balík (obal i karty v něm)
      // přejede z původní polohy a velikosti, místo aby skočil.
      if (packFrom && packFrom.width > 0) {
        const to = ctx.pack.el.getBoundingClientRect();
        const origin = pile.getBoundingClientRect();
        const scale = packFrom.width / to.width;
        const tx = packFrom.left - origin.left - scale * (to.left - origin.left);
        const ty = packFrom.top - origin.top - scale * (to.top - origin.top);
        await pile
          .animate(
            [
              { transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: "0 0" },
              { transform: "none", transformOrigin: "0 0" },
            ],
            { duration: 450, easing: "cubic-bezier(0.3, 0.7, 0.3, 1)" },
          )
          .finished.catch(() => undefined);
      } else {
        await sleep(80);
      }
      pile.classList.add("is-rising");
      // u vzácnějších karet světlo chvíli posvítí, než obal odjede
      await sleep(750 + [0, 0, 150, 350, 500][light?.tier ?? 0]);
      const dropped = ctx.pack.drop();
      pile.classList.remove("is-rising");
      light?.el.classList.remove("is-on");
      await dropped;
      wrap.remove();
      pile.classList.remove("pile--intro");
    } else if (!reduced) {
      await sleep(700);
    }
    light?.el.remove();
    busy = false;
    revealCurrent();
  };
  intro();
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
    // okolí ztmavne do barvy rarity a plují v něm rozmazaná světla
    stage.style.setProperty("--sc", tier >= 4 ? "#ffd65a" : color);
    bokeh(stage, color, tier);
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
