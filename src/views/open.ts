// Otevírání balíčků: výběr sady, 3D balíček a jeho roztržení, pak balík karet
// (openPile.ts) a přehled (openSummary.ts). Přehrávání god packu ze Síně slávy.
import { loadCards, loadPools, loadSets, setIdOfCard } from "../data";
import { t } from "../i18n";
import { packProfile, rarityInfo } from "../odds";
import { fromSealed, hintLevel, isGodPack, openPack } from "../pack";
import { getState, nextSealed, recordOpening, recordOpenings } from "../store";
import type { Card, PulledCard, SetInfo } from "../types";
import { animationEnd, append, clear, h, sleep } from "../ui/dom";
import { CARD_BACK_URL, preload } from "../ui/holo";
import { groupBySeries } from "../ui/eras";
import { packThumb, prefetchPackArt } from "../ui/pack";
import { createPackModel, type PackModel } from "../ui/packModel";
import { fxPrefs, setFxPrefs, sfxGodPack, sfxHit, sfxRip, sfxTear, unlockAudio } from "../ui/sfx";
import { cssPack } from "./openCssPack";
import { showPile } from "./openPile";
import { showSummary } from "./openSummary";

/** Výběr sady z neotevřených balíčků. */
async function renderInventory(root: HTMLElement) {
  const sets = await loadSets();
  const packs = getState().packs;
  const owned = sets.filter((s) => packs[s.id]);
  root.append(h("section", { class: "view-head" }, h("h1", null, t.open.inventoryTitle)));
  if (owned.length === 0) {
    root.append(
      h(
        "div",
        { class: "empty" },
        h("p", null, t.open.noPacks),
        h("a", { class: "btn btn--primary", href: "#/shop" }, t.common.toShop),
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
    root.append(h("p", { class: "empty" }, t.common.unknownSet));
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
    root.append(h("p", { class: "empty" }, t.open.notInHall));
    return;
  }
  const byId = new Map<string, Card>();
  for (const id of new Set(record.cards.map((c) => setIdOfCard(c.id)))) {
    for (const c of await loadCards(id)) byId.set(c.id, c);
  }
  const replay = fromSealed(record, byId);
  if (!replay) {
    root.append(h("p", { class: "empty" }, t.open.replayLoadFailed));
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
      const target = e.target instanceof Element ? e.target : null;
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
    this.remaining.textContent = this.replay ? t.open.replaying : t.open.remaining(this.left());
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
          h("p", null, t.open.soldOut),
          h("a", { class: "btn btn--primary", href: "#/shop" }, t.open.getMore),
          h("a", { class: "btn", href: `#/album/${this.set.id}` }, t.common.toAlbum),
        ),
      );
      return;
    }

    // Balíček vybraný z regálu má obsah daný předem (a s ním i tajný náznak).
    const sealed = this.replay ?? this.sealedCards();
    this.prepare();
    const hintLvl = sealed ? hintLevel(sealed) : 0;
    const hint = h("p", { class: "stage__hint" }, t.open.packHint);

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
        onCut: sfxRip,
        alive: () => this.root.isConnected,
      });
    }
    const model = this.model;
    target = model ?? cssPack(this.set, hintLvl, tear);
    this.stage.append(h("div", { class: "pack-wrap" }, model ? model.el : (target as HTMLElement)), hint);
    this.keys = (e) => {
      if (e.key !== "Enter" && e.key !== " ") return false;
      unlockAudio();
      tear();
      return true;
    };

    append(this.controls, [
      this.replay
        ? h("a", { class: "btn", href: "#/stats" }, t.common.backToHall)
        : h("button", { class: "btn", onclick: once(() => (unlockAudio(), this.quickOpen(1))) }, t.open.quickOpen),
      !this.replay && this.left() > 1
        ? h("button", { class: "btn", onclick: once(() => (unlockAudio(), this.quickOpen(this.left()))) }, t.open.openAll(this.left()))
        : null,
    ]);
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
    showPile(
      {
        stage: this.stage,
        controls: this.controls,
        setKeys: (fn) => (this.keys = fn),
        done: () => this.summary(cards, fresh),
      },
      cards,
      fresh,
    );
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
    if (godPacks) sfxGodPack();
    else if (best >= 0) sfxHit(best);
  }

  private summary(cards: PulledCard[], fresh: Set<string>, packs = 1, godPacks = packs === 1 && isGodPack(cards) ? 1 : 0) {
    this.updateRemaining();
    showSummary(
      {
        stage: this.stage,
        controls: this.controls,
        set: this.set,
        replay: Boolean(this.replay),
        left: this.left,
        next: () => this.showPack(),
        setKeys: (fn) => (this.keys = fn),
      },
      cards,
      fresh,
      packs,
      godPacks,
    );
    // Další balíček se připraví (a jeho karty stáhnou), zatímco hráč prohlíží přehled.
    this.prepare();
  }
}

/** Tlačítko pro rychlé ztlumení zvuků přímo při otevírání. */
function soundToggle(): HTMLElement {
  const btn = h("button", { class: "btn btn--ghost sound-toggle" });
  const render = () => {
    const on = fxPrefs().sound;
    btn.textContent = on ? "🔊" : "🔇";
    btn.setAttribute("aria-label", on ? t.open.soundOff : t.open.soundOn);
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
