import { loadCards, loadPools, loadSets, setIdOfCard } from "../data";
import { packProfile, rarityInfo, VARIANT_LABEL } from "../odds";
import { fromSealed, hintLevel, isGodPack, openPack } from "../pack";
import { addPrice, type CardPrice, formatEur, formatTotal, formatUsd, loadSetPrices, type PriceTotal, variantPrice } from "../prices";
import { collectionKey, getState, nextSealed, recordOpening, recordOpenings } from "../store";
import type { Card, PulledCard, SetInfo } from "../types";
import { animationEnd, append, clear, h, prefersReducedMotion, sleep } from "../ui/dom";
import { CARD_BACK_URL, cardBack, cardEl, enableTilt, preload } from "../ui/holo";
import { groupBySeries } from "../ui/eras";
import { packEl, packThumb, prefetchPackArt } from "../ui/pack";
import { createPackModel, type PackModel } from "../ui/packModel";
import { CHARGE_MS, flash, goldRain, rarityBanner, rays, shake, shockwave, stars, tierOf } from "../ui/reveal";
import { fxPrefs, setFxPrefs, sfxCharge, sfxFlip, sfxHit, sfxSwipe, sfxTear, unlockAudio } from "../ui/sfx";
import { openCardModal } from "./cardModal";

const priceSetIds = (cards: PulledCard[]) => [...new Set(cards.map((c) => setIdOfCard(c.card.id)))];

/** Výběr sady z neotevřených balíčků. */
async function renderInventory(root: HTMLElement) {
  const sets = await loadSets();
  const packs = getState().packs;
  const owned = sets.filter((s) => packs[s.id]);
  root.append(h("section", { class: "view-head" }, h("h1", null, "Moje balíčky")));
  if (owned.length === 0) {
    root.append(
      h(
        "div",
        { class: "empty" },
        h("p", null, "Nemáš žádné neotevřené balíčky."),
        h("a", { class: "btn btn--primary", href: "#/shop" }, "Do obchodu"),
      ),
    );
    return;
  }
  owned.forEach((s) => prefetchPackArt(s.id));
  // Balíčky podle éry (sady jsou od nejnovější).
  for (const { series, items } of groupBySeries(owned, (s) => s.series)) {
    root.append(
      h("h2", { class: "era-heading" }, series, h("span", { class: "muted" }, ` · ${items.reduce((n, s) => n + packs[s.id], 0)}×`)),
      h(
        "div",
        { class: "inventory" },
        ...items.map((s) =>
          h(
            "a",
            { class: "inventory__item", href: `#/open/${s.id}` },
            packThumb(s),
            h("strong", null, s.name),
            h("span", { class: "chip" }, `${packs[s.id]}×`),
          ),
        ),
      ),
    );
  }
}

export async function renderOpen(root: HTMLElement, setId?: string) {
  if (!setId) return renderInventory(root);
  const sets = await loadSets();
  const set = sets.find((s) => s.id === setId);
  if (!set) {
    root.append(h("p", { class: "empty" }, "Neznámá sada."));
    return;
  }
  const [pools, cards] = await Promise.all([loadPools(set.id), loadCards(set.id)]);
  new OpeningStage(root, set, pools, new Map(cards.map((c) => [c.id, c]))).showPack();
}

/**
 * Přehrání god packu ze Síně slávy (#/replay/<čas otevření>): stejné roztržení
 * a odhalování se stejnými kartami, ale nic se nezapisuje (sbírka, statistiky, zásoba).
 */
export async function renderReplay(root: HTMLElement, at?: string) {
  const record = getState().hallOfFame.find((r) => String(r.at) === at);
  const sets = await loadSets();
  const set = record && sets.find((s) => s.id === record.setId);
  if (!record || !set) {
    root.append(h("p", { class: "empty" }, "Tento balíček v Síni slávy není."));
    return;
  }
  const byId = new Map<string, Card>();
  for (const id of new Set(record.cards.map((c) => setIdOfCard(c.id)))) {
    for (const c of await loadCards(id)) byId.set(c.id, c);
  }
  const replay = fromSealed(record, byId);
  if (!replay) {
    root.append(h("p", { class: "empty" }, "Karty tohoto balíčku se nepodařilo načíst."));
    return;
  }
  new OpeningStage(root, set, await loadPools(set.id), byId, replay).showPack();
}

class OpeningStage {
  private stage = h("div", { class: "stage" });
  private controls = h("div", { class: "stage__controls" });
  private remaining = h("span", { class: "chip" });
  /** Obsah dalšího balíčku, vylosovaný dopředu, aby se obrázky karet stáhly ještě před roztržením. */
  private pending: PulledCard[] | null = null;
  /** 3D model balíčku (WebGL) – jeden pro celou obrazovku; null = WebGL není, undefined = zatím nezkoušeno. */
  private model: PackModel | null | undefined = undefined;
  /** Co udělá klávesa na aktuálním kroku (balíček / karty). */
  private keys: ((e: KeyboardEvent) => boolean) | null = null;

  constructor(
    private root: HTMLElement,
    private set: SetInfo,
    private pools: Map<string, Card[]>,
    private byId: Map<string, Card>,
    /** Přehrávání god packu ze Síně slávy: pevné karty, nic se nezapisuje. */
    private replay: PulledCard[] | null = null,
  ) {
    // Klávesnice: Enter / mezerník roztrhne balíček, otočí nebo odhodí kartu,
    // šipky ji odhodí do strany. Posluchač se odpojí po odchodu z obrazovky.
    const onKey = (e: KeyboardEvent) => {
      if (!this.root.isConnected) {
        document.removeEventListener("keydown", onKey);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest("button, a, input, select, textarea") || document.querySelector(".modal, .viewer")) return;
      if (this.keys?.(e)) e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    root.append(
      h(
        "section",
        { class: "view-head view-head--row" },
        h("h1", null, set.name),
        h("div", { class: "row" }, soundToggle(), this.remaining),
      ),
      this.stage,
      this.controls,
    );
  }

  private left = () => (this.replay ? 1 : (getState().packs[this.set.id] ?? 0));

  private updateRemaining() {
    this.remaining.textContent = this.replay ? "Přehrávání" : `Zbývá: ${this.left()}`;
  }

  showPack() {
    this.updateRemaining();
    clear(this.stage);
    clear(this.controls);
    if (this.left() === 0) {
      this.stage.append(
        h(
          "div",
          { class: "empty" },
          h("p", null, "Balíčky této sady došly."),
          h("a", { class: "btn btn--primary", href: "#/shop" }, "Vzít další v obchodě"),
          h("a", { class: "btn", href: `#/album/${this.set.id}` }, "Do alba"),
        ),
      );
      return;
    }

    // Balíček vybraný z regálu má obsah daný předem (a s ním i tajný náznak).
    const sealed = this.replay ?? this.sealedCards();
    this.prepare();
    const hintLvl = sealed ? hintLevel(sealed) : 0;
    const hint = h("p", { class: "stage__hint" }, "Přejeď prstem přes horní okraj, nebo klepni. Tažením jinde balíčkem otočíš.");

    let done = false;
    const once = (fn: () => void) => () => {
      if (done) return;
      done = true;
      fn();
    };
    let target: PackModel | HTMLElement | null = null;
    const tear = once(() => {
      sfxTear();
      hint.remove();
      if (target) this.open(target);
    });

    // Skutečný 3D model (WebGL), jeden pro celou obrazovku: u dalšího balíčku se jen
    // vrátí do výchozího stavu. Bez WebGL starší balíček poskládaný z CSS vrstev.
    if (this.model?.usable()) this.model.reset({ hint: hintLvl, onTear: tear });
    else if (this.model !== null) {
      this.model = createPackModel(this.set, {
        hint: hintLvl,
        onTear: tear,
        onPointerDown: unlockAudio,
        alive: () => this.root.isConnected,
      });
    }
    const model = this.model;
    target = model ?? this.cssPack(hintLvl, tear);
    this.stage.append(h("div", { class: "pack-wrap" }, model ? model.el : (target as HTMLElement)), hint);
    this.keys = (e) => {
      if (e.key !== "Enter" && e.key !== " ") return false;
      unlockAudio();
      tear();
      return true;
    };

    append(this.controls, [
      this.replay
        ? h("a", { class: "btn", href: "#/stats" }, "← Síň slávy")
        : h("button", { class: "btn", onclick: once(() => (unlockAudio(), this.quickOpen(1))) }, "Otevřít bez animace"),
      !this.replay && this.left() > 1
        ? h("button", { class: "btn", onclick: once(() => (unlockAudio(), this.quickOpen(this.left()))) }, `Otevřít vše (${this.left()})`)
        : null,
    ]);
  }

  /**
   * Záložní balíček z CSS vrstev (prohlížeč bez WebGL): tažení přes horní pruh ho
   * roztrhne, tažení jinde jím otáčí, prosté klepnutí ho otevře.
   */
  private cssPack(hintLvl: number, tear: () => void): HTMLElement {
    const pack = packEl(this.set, { large: true, tilt: true, hint: hintLvl });
    pack.classList.add("pack3d--big", "pack3d--idle");
    const cut = h("div", { class: "pack3d__cut" });
    pack.querySelector(".pack3d__body")!.append(cut);
    let drag: { x: number; mode: "tear" | "spin" } | null = null;
    let torn = false;
    const tearOnce = () => {
      if (torn) return;
      torn = true;
      pack.classList.remove("is-dragging");
      pack.style.setProperty("--spin", "0deg");
      tear();
    };
    pack.addEventListener("pointerdown", (e) => {
      unlockAudio();
      const r = pack.getBoundingClientRect();
      drag = { x: e.clientX, mode: e.clientY - r.top < r.height * 0.3 ? "tear" : "spin" };
      pack.classList.add("is-dragging");
      pack.setPointerCapture(e.pointerId);
    });
    pack.addEventListener("pointermove", (e) => {
      if (!drag || torn) return;
      const dx = e.clientX - drag.x;
      if (drag.mode === "spin") {
        pack.style.setProperty("--spin", `${dx * 0.9}deg`);
        return;
      }
      const progress = Math.min(1, Math.abs(dx) / (pack.getBoundingClientRect().width * 0.7));
      cut.style.setProperty("--cut", String(progress));
      if (progress >= 1) tearOnce();
    });
    const release = (e: PointerEvent) => {
      if (!drag) return;
      const moved = Math.abs(e.clientX - drag.x) > 8;
      drag = null;
      pack.classList.remove("is-dragging");
      if (torn) return;
      if (!moved) tearOnce();
      else {
        cut.style.setProperty("--cut", "0");
        pack.style.setProperty("--spin", "0deg");
      }
    };
    pack.addEventListener("pointerup", release);
    pack.addEventListener("pointercancel", release);
    return pack;
  }

  /** Obsah dalšího balíčku vybraného z regálu, pokud nějaký čeká. */
  private sealedCards(): PulledCard[] | null {
    const next = nextSealed(this.set.id);
    return next ? fromSealed(next, this.byId) : null;
  }

  /**
   * Vylosuje obsah dalšího balíčku dopředu (bez zápisu do sbírky) a začne stahovat
   * obrázky jeho karet. Do sbírky se zapíše až při roztržení (draw).
   */
  private prepare() {
    if (this.replay) {
      preload([...this.replay.map((c) => c.card.img), CARD_BACK_URL]);
      return;
    }
    if (this.pending || this.left() === 0) return;
    this.pending = this.sealedCards() ?? openPack(packProfile(this.set.id), this.pools);
    preload([...this.pending.map((c) => c.card.img), CARD_BACK_URL]);
  }

  private draw(): { cards: PulledCard[]; fresh: Set<string> } {
    if (this.replay) return { cards: this.replay, fresh: new Set() };
    const cards = this.pending ?? this.sealedCards() ?? openPack(packProfile(this.set.id), this.pools);
    this.pending = null;
    const fresh = recordOpening(this.set.id, cards);
    this.updateRemaining();
    return { cards, fresh };
  }

  private async open(target: PackModel | HTMLElement) {
    clear(this.controls);
    const { cards, fresh } = this.draw();
    const imagesReady = preload([...cards.map((c) => c.card.img), CARD_BACK_URL]);

    let torn: Promise<void>;
    if (target instanceof HTMLElement) {
      target.classList.remove("pack3d--idle");
      target.classList.add("pack3d--torn");
      torn = animationEnd(target.querySelector(".pack3d__piece--main")!, 1400);
    } else {
      torn = target.tear();
    }
    await Promise.race([Promise.all([torn, imagesReady]), sleep(2600)]);
    this.reveal(cards, fresh);
  }

  private reveal(cards: PulledCard[], fresh: Set<string>) {
    clear(this.stage);
    const counter = h("div", { class: "stage__counter" });
    const stack = h("div", { class: "pile__stack" });
    const pile = h("div", { class: "pile" }, stack);
    enableTilt(pile);
    this.stage.append(pile, counter, h("p", { class: "stage__hint" }, "Klepni na kartu, nebo ji odhoď do strany"));
    // God pack: celý balík zazáří a objeví se nápis (první karta je hned vzácná).
    if (isGodPack(cards)) {
      pile.classList.add("pile--god");
      this.godBanner();
    }

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
          isNew ? h("span", { class: "badge badge--new" }, "NOVÁ") : null,
          pulled.variant !== "normal" ? h("span", { class: "badge" }, VARIANT_LABEL[pulled.variant]) : null,
          info.hit ? h("span", { class: "badge", style: `background: ${info.color}; color: #111` }, pulled.card.rarity) : null,
        ),
      );
      stack.append(item);
      return item;
    });

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
      this.revealHit(item, rank);
      await sleep(350);
      item.classList.remove("is-flipping");
      busy = false;
    };

    const throwAway = async (item: HTMLElement, dir: number) => {
      item.style.setProperty("--dir", String(dir));
      item.classList.add("is-gone");
      sfxSwipe();
      index++;
      update();
      if (index >= items.length) {
        await sleep(300);
        this.summary(cards, fresh);
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
    this.keys = (e) => {
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
    };

    this.controls.append(
      h("button", { class: "btn", onclick: () => this.summary(cards, fresh) }, "Přeskočit na přehled"),
    );
  }

  /** Vzácná karta se po odhalení rozzáří barvou rarity a vybuchne částicemi. */
  /** Efekty odhalení vzácné karty podle úrovně rarity (src/ui/reveal.ts). */
  private revealHit(item: HTMLElement, rank: number) {
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
      this.stage.classList.add("stage--spotlight");
      setTimeout(() => this.stage.classList.remove("stage--spotlight"), 2400);
      const name = item.dataset.rarity ?? "";
      rarityBanner(this.stage, name, color, tier);
      flash(tier >= 4 ? "#ffd65a" : color);
    }
    if (tier >= 4) {
      goldRain(this.stage);
      if (pile) shake(pile);
    }
  }

  /** Nápis GOD PACK přes balík karet, s nejsilnější fanfárou a vibrací. */
  private godBanner() {
    const banner = h("div", { class: "god-banner", role: "status" }, "GOD PACK!");
    this.stage.append(banner);
    sfxHit(10);
    if (!prefersReducedMotion()) flash("#ffd65a");
    setTimeout(() => banner.remove(), 2600);
  }

  /** Otevře více balíčků naráz bez animace a ukáže souhrn. */
  private quickOpen(count: number) {
    count = Math.min(count, this.left());
    // Obsah všech balíčků: připravený první, pak vybrané z regálu (v pořadí), zbytek naslepo.
    const sealed = getState().sealed[this.set.id] ?? [];
    const packs: PulledCard[][] = [];
    for (let i = 0; i < count; i++) {
      const fromShelf = sealed[i] ? fromSealed(sealed[i], this.byId) : null;
      packs.push((i === 0 ? this.pending : null) ?? fromShelf ?? openPack(packProfile(this.set.id), this.pools));
    }
    this.pending = null;
    const freshSets = recordOpenings(this.set.id, packs);
    const all = packs.flat();
    const fresh = new Set(freshSets.flatMap((f) => [...f]));
    const godPacks = packs.filter(isGodPack).length;
    this.summary(all, fresh, count, godPacks);
    // Fanfára podle nejvzácnější karty ze všech otevřených balíčků (god pack má nejsilnější).
    const best = Math.max(-1, ...all.filter((c) => rarityInfo(c.card.rarity).hit).map((c) => rarityInfo(c.card.rarity).rank));
    if (godPacks) sfxHit(10);
    else if (best >= 0) sfxHit(best);
  }

  private summary(cards: PulledCard[], fresh: Set<string>, packs = 1, godPacks = packs === 1 && isGodPack(cards) ? 1 : 0) {
    clear(this.stage);
    clear(this.controls);
    this.updateRemaining();

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

    const total = h("strong", null, "načítám ceny…");
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
        { class: "summary__item", onclick: () => openCardModal(pulled.card, this.set) },
        cardEl(pulled.card, pulled.variant),
        count > 1 ? h("span", { class: "count-badge" }, `×${count}`) : null,
        h(
          "div",
          { class: "summary__meta" },
          h("span", { class: "rarity-chip", style: `--rc: ${rarityInfo(pulled.card.rarity).color}` }, rarityInfo(pulled.card.rarity).short),
          fresh.has(collectionKey(pulled.card.id, pulled.variant)) ? h("span", { class: "badge badge--new" }, "NOVÁ") : null,
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
      if (list.length === 0) grid.append(h("p", { class: "muted" }, "Tentokrát žádná vzácná karta."));
      toggle.textContent = showAll ? "Jen vzácné karty" : `Zobrazit všechny karty (${entries.length})`;
    };
    toggle.addEventListener("click", () => {
      showAll = !showAll;
      renderGrid();
    });
    renderGrid();

    this.stage.append(
      h(
        "div",
        { class: `summary${godPacks ? " summary--god" : ""}` },
        h(
          "div",
          { class: "summary__head" },
          h("h2", null, packs > 1 ? `Otevřeno ${packs} balíčků` : godPacks ? "GOD PACK!" : "Tvůj balíček"),
          packs > 1 && godPacks
            ? h("p", { class: "summary__god" }, godPacks === 1
                ? "V balíčcích byl god pack!"
                : godPacks < 5
                  ? `V balíčcích byly ${godPacks} god packy!`
                  : `V balíčcích bylo ${godPacks} god packů!`)
            : null,
          this.replay
            ? h("p", { class: "muted" }, "Přehrávání ze Síně slávy – karty se do sbírky znovu nepřidávají. Hodnota ", total)
            : h("p", null, `${cards.length} karet · ${fresh.size} nových do sbírky · hodnota `, total),
          packs > 1 ? h("div", { class: "row" }, h("span", { class: "muted" }, `Vzácných karet: ${hits.reduce((n, e) => n + e.count, 0)}`), toggle) : null,
        ),
        grid,
      ),
    );

    this.keys = (e) => {
      if (e.key !== "Enter" || this.left() === 0) return false;
      unlockAudio();
      this.showPack();
      return true;
    };
    this.controls.append(
      this.replay
        ? h("button", { class: "btn btn--primary", onclick: () => (unlockAudio(), this.showPack()) }, "▶ Přehrát znovu")
        : this.left() > 0
          ? h("button", { class: "btn btn--primary", onclick: () => (unlockAudio(), this.showPack()) }, `Otevřít další (${this.left()})`)
          : h("a", { class: "btn btn--primary", href: "#/shop" }, "Vzít další balíčky"),
      this.replay
        ? h("a", { class: "btn", href: "#/stats" }, "← Síň slávy")
        : h("a", { class: "btn", href: `#/album/${this.set.id}` }, "Do alba"),
    );

    // Další balíček se připraví (a jeho karty stáhnou), zatímco hráč prohlíží přehled.
    this.prepare();

    loadSetPrices(priceSetIds(cards)).then((loaded) => {
      prices = loaded;
      const sum: PriceTotal = {};
      for (const pulled of cards) addPrice(sum, variantPrice(loaded[pulled.card.id], pulled.variant));
      total.textContent = formatTotal(sum, true);
      for (const { el, pulled } of priceEls) el.textContent = priceText(pulled);
    });
  }
}

/** Tlačítko pro rychlé ztlumení zvuků přímo při otevírání. */
function soundToggle(): HTMLElement {
  const btn = h("button", { class: "btn btn--ghost sound-toggle" });
  const render = () => {
    const on = fxPrefs().sound;
    btn.textContent = on ? "🔊" : "🔇";
    btn.setAttribute("aria-label", on ? "Vypnout zvuky" : "Zapnout zvuky");
    btn.setAttribute("aria-pressed", String(on));
  };
  btn.addEventListener("click", () => {
    setFxPrefs({ sound: !fxPrefs().sound });
    unlockAudio();
    render();
  });
  render();
  return btn;
}
