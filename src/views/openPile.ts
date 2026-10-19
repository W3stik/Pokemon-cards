// Balík karet po roztržení balíčku, jako v ruce: karty vyjedou z obalu (3D model leží
// nad balíkem a zakrývá jeho spodek, pak sjede dolů), další karta se vytahuje zezadu
// balíku a pokládá dopředu. Karta sleduje prst; vytažená celá ven jde do popředí a jde ji
// položit tahem, krátký švih nebo klepnutí ji dotáhne samo. Na konci je v ruce celý
// balík a nejvzácnější karta vepředu. Vzácné karty nejsou rubem nahoru: zpoza balíku
// prosvítá barva rarity karty, která je na řadě, efekty (src/ui/reveal.ts) přijdou po položení.
import { t } from "../i18n";
import { rarityInfo, VARIANT_LABEL } from "../odds";
import { isGodPack } from "../pack";
import { collectionKey } from "../store";
import type { PulledCard } from "../types";
import { clear, h, prefersReducedMotion, sleep } from "../ui/dom";
import { cardEl, enableTilt } from "../ui/holo";
import { flash, goldRain, rarityBanner, rays, shake, shockwave, stars, tierOf } from "../ui/reveal";
import { sfxDeal, sfxGodPack, sfxHit, sfxSwipe, unlockAudio } from "../ui/sfx";

export interface PileContext {
  stage: HTMLElement;
  controls: HTMLElement;
  /** Nastaví, co dělají klávesy (Enter / mezerník / šipka nahoru). */
  setKeys(handler: (e: KeyboardEvent) => boolean): void;
  /** Všechny karty jsou v ruce a hráč pokračuje, nebo přeskočil: přehled. */
  done(): void;
  /** Roztržený 3D obal, ze kterého karty vyjedou (bez WebGL chybí, karty pak vyjedou zespodu). */
  pack?: { el: HTMLElement; ratio: number; drop(): Promise<void> };
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
  clear(stage);
  const reduced = prefersReducedMotion();
  const fromPack = Boolean(ctx.pack) && !reduced;
  const counter = h("div", { class: "stage__counter" });
  const hint = h("p", { class: "stage__hint" });
  const stack = h("div", { class: "pile__stack" });
  const pile = h("div", { class: `pile ${fromPack ? "pile--intro" : "pile--rise-in"}` }, stack);
  enableTilt(pile);
  stage.append(pile, counter, hint);

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

  // Pořadí v ruce: vepředu poslední položená karta, za ní dřív položené, vzadu ty, které
  // přijdou na řadu – úplně vzadu ta další (vytahuje se zezadu). Karta 0 je vepředu hned.
  let next = 1;
  /** Položené karty nejsou srovnané úplně přesně; ty v balíku jsou rovně (nevykukují). */
  const tilt = (i: number) => (((i * 37) % 7) - 3) * 0.6;
  const depthOf = (i: number) => (i < next ? next - 1 - i : next + (n - 1 - i));
  const backZ = () => -(n - 1) * 3;
  const layout = () => {
    items.forEach((item, i) => {
      const d = depthOf(i);
      item.style.setProperty("--z", `${-d * 3}px`);
      item.style.setProperty("--rot", i < next ? `${tilt(i)}deg` : "0deg");
      item.style.zIndex = String(n - d);
      item.classList.toggle("is-current", i === next - 1);
    });
    counter.textContent = `${Math.min(next, n)} / ${n}`;
    hint.textContent = next < n ? t.open.pileHint : t.open.pileDone;
    // napětí: zpoza balíku prosvítá barva vzácné karty, která je na řadě
    const waiting = next < n ? rarityInfo(cards[next].card.rarity) : null;
    const tease = Boolean(waiting?.hit);
    pile.classList.toggle("pile--tease", tease);
    for (const tier of [1, 2, 3, 4]) pile.classList.toggle(`pile--tier-${tier}`, tease && tierOf(waiting!.rank) === tier);
    if (waiting && tease) pile.style.setProperty("--tease", waiting.color);
  };
  layout();

  let busy = true;
  const width = () => pile.clientWidth || 1;
  const height = () => pile.clientHeight || 1;

  /** Položení vytažené karty dopředu (z pózy, ve které je teď) a efekty vzácné karty. */
  const place = async (item: HTMLElement, from: Pose) => {
    busy = true;
    const i = next;
    next++;
    layout();
    item.classList.remove("is-pulled");
    // Pozici přebírá CSS (--z, --rot z layout); is-dragging vypíná přechod, aby po animaci
    // nedojížděl a kartou necuknul.
    const anim = reduced
      ? null
      : item.animate([{ transform: transform(from, 4, 1.03) }, { transform: transform({ x: 0, y: 0, rot: tilt(i) }, 0) }], {
          duration: 320,
          easing: "cubic-bezier(0.2, 0.9, 0.3, 1.15)",
        });
    item.style.transform = "";
    await anim?.finished.catch(() => undefined);
    item.classList.remove("is-dragging");
    const info = rarityInfo(cards[i].card.rarity);
    if (info.hit) revealHit(stage, item, info.rank);
    if (next === n) await announceGod();
    busy = false;
  };

  /**
   * Dotažení karty zezadu: pokračuje směrem tahu (bez tahu nahoru), dokud balík nepřestane
   * překrývat – teprve pak jde dopředu, takže neproskočí skrz ostatní karty.
   */
  const pullOut = async (from: Pose, dirX: number, dirY: number) => {
    busy = true;
    const item = items[next];
    item.classList.add("is-pulled", "is-dragging");
    const len = Math.hypot(dirX, dirY) || 1;
    const ux = dirX / len;
    const uy = len > 0.0001 ? dirY / len : -1;
    const s = 1.03 / Math.max(Math.abs(ux) / width(), Math.abs(uy) / height(), 1e-6);
    const out: Pose = { x: ux * s, y: uy * s, rot: from.rot * 1.2 };
    sfxSwipe(ux < 0 ? -1 : 1);
    if (!reduced) {
      const anim = item.animate([{ transform: transform(from, backZ(), 1.02) }, { transform: transform(out, backZ(), 1.03) }], {
        duration: 200,
        easing: "cubic-bezier(0.3, 0.6, 0.5, 1)",
        fill: "forwards",
      });
      await anim.finished.catch(() => undefined);
      item.style.transform = transform(out, 4, 1.03);
      anim.cancel();
    }
    await place(item, out);
  };

  const advance = () => {
    if (busy) return;
    if (next >= n) return ctx.done();
    pullOut({ x: 0, y: 0, rot: 0 }, 0, -1);
  };

  // Tah prstem: karta zezadu se drží tam, kde jsi ji chytil, a natáčí se podle místa úchopu.
  let drag: {
    item: HTMLElement;
    x0: number;
    y0: number;
    grabY: number;
    moved: boolean;
    front: boolean;
    pose: Pose;
    samples: { x: number; y: number; t: number }[];
  } | null = null;
  pile.addEventListener("pointerdown", (e) => {
    unlockAudio();
    if (busy) return;
    if (next >= n) {
      ctx.done();
      return;
    }
    const r = pile.getBoundingClientRect();
    drag = {
      item: items[next],
      x0: e.clientX,
      y0: e.clientY,
      grabY: (e.clientY - r.top) / r.height - 0.5,
      moved: false,
      front: false,
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
      drag.item.classList.add("is-pulled", "is-dragging");
      if (drag.item.classList.contains("is-hit")) pile.classList.add("pile--pulling");
    }
    const now = performance.now();
    drag.samples.push({ x: e.clientX, y: e.clientY, t: now });
    while (drag.samples.length > 2 && now - drag.samples[0].t > 90) drag.samples.shift();
    // chycená nad středem se při tahu do strany natáčí jedním směrem, pod středem druhým
    const rot = Math.max(-22, Math.min(22, (dx / width()) * 18 * (drag.grabY < 0 ? 1 : -1)));
    drag.pose = { x: dx, y: dy, rot };
    // vytažená celá ven (balík ji už nepřekrývá) jde do popředí, odtud ji položíš tahem
    if (!drag.front && Math.max(Math.abs(dx) / width(), Math.abs(dy) / height()) >= 1) drag.front = true;
    drag.item.style.transform = transform(drag.pose, drag.front ? 4 : backZ(), 1.02);
  });
  const release = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    pile.classList.remove("pile--pulling");
    if (!d.moved) {
      advance();
      return;
    }
    if (d.front) {
      place(d.item, d.pose);
      return;
    }
    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const dt = Math.max(1, last.t - first.t);
    const vx = (last.x - first.x) / dt;
    const vy = (last.y - first.y) / dt;
    const pulled = Math.max(Math.abs(d.pose.x) / width(), Math.abs(d.pose.y) / height());
    const outward = vx * d.pose.x + vy * d.pose.y > 0;
    if (pulled >= 0.4 || (Math.hypot(vx, vy) > 0.5 && outward)) {
      pullOut(d.pose, d.pose.x || vx, d.pose.y || vy);
    } else {
      // vytažená málo: zajede zpátky dozadu
      d.item.classList.remove("is-dragging", "is-pulled");
      d.item.style.transform = "";
    }
  };
  pile.addEventListener("pointerup", release);
  pile.addEventListener("pointercancel", release);
  ctx.setKeys((e) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "ArrowUp") return false;
    advance();
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
      await sleep(80);
      pile.classList.add("is-rising");
      await sleep(750);
      const dropped = ctx.pack.drop();
      pile.classList.remove("is-rising");
      await dropped;
      wrap.remove();
      pile.classList.remove("pile--intro");
    } else if (!reduced) {
      await sleep(700);
    }
    busy = false;
    const first = rarityInfo(cards[0].card.rarity);
    if (first.hit) revealHit(stage, items[0], first.rank);
    if (n === 1) announceGod();
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
