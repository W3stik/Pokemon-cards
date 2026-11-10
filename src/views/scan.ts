// Skener skutečných karet (#/scan): kamera přes celou obrazovku, karta se zarovná do
// rámečku a snímky se průběžně rozpoznávají (src/scan/match.ts). Kartu poznanou s jistotou
// ve dvou snímcích po sobě přidá sám do Mých karet; dotisky se stejným obrázkem a nejisté
// karty nabídne k výběru. Stejná karta v záběru se nepřidá dvakrát (další kus přes „+1“).
import { t } from "../i18n";
import { formatEur, formatUsd, variantPrice } from "../prices";
import { cardInfo } from "../scan/cardInfo";
import { loadScanDb, type ScanCard, type ScanIndex } from "../scan/db";
import { type CardDb, identify } from "../scan/match";
import type { Placement } from "../scan/verify";
import { addReal, realCounts } from "../store";
import type { Variant } from "../types";
import { h, toast } from "../ui/dom";

// Snímek pro rozpoznání: výřez z kamery kolem rámečku, rámeček uprostřed.
const FRAME_W = 480;
const FRAME_H = 660;
const GUIDE_W = 360;
const GUIDE_H = 503;
const GUIDE: Placement = [FRAME_W / 2, FRAME_H / 2, GUIDE_W, 0, 0, GUIDE_H];

/** Od jaké shody a odstupu od nejlepší jiné karty se karta přidá sama. */
const SURE = 0.62;
const MARGIN = 0.1;
/** Pod touhle shodou v záběru žádná karta není. */
const EMPTY = 0.45;
/** Karty stejného jména takhle blízko nejlepší jsou dotisky se stejným obrázkem. */
const TWIN = 0.06;
/** Kolik snímků po sobě musí vyjít stejně. */
const CONFIRM = 2;
/** Po kolika nejistých snímcích se nabídne výběr. */
const UNSURE_FRAMES = 8;

type ScanVariant = Extract<Variant, "normal" | "reverse">;

interface Added {
  card: ScanCard;
  variant: ScanVariant;
  undone: boolean;
}

export function priceLabel(price: { eur?: number; usd?: number }): string {
  return price.eur !== undefined ? formatEur(price.eur) : price.usd !== undefined ? formatUsd(price.usd) : "–";
}

export function renderScan(root: HTMLElement) {
  const video = h("video", { class: "scan__video", playsinline: true, muted: true, autoplay: true });
  const guide = h("div", { class: "scan__guide" });
  const status = h("p", { class: "scan__status", role: "status" });
  const tray = h("div", { class: "scan__tray" });
  const chooser = h("div", { class: "scan__chooser hidden" });
  let variant: ScanVariant = "normal";
  const variantBtn = h("button", { class: "scan__btn scan__btn--wide" });
  const setVariant = (next: ScanVariant) => {
    variant = next;
    variantBtn.textContent = next === "normal" ? t.scan.normal : t.scan.reverse;
    variantBtn.classList.toggle("is-on", next === "reverse");
  };
  variantBtn.addEventListener("click", () => setVariant(variant === "normal" ? "reverse" : "normal"));
  setVariant("normal");
  const torchBtn = h("button", { class: "scan__btn hidden", "aria-label": t.scan.torch }, "🔦");
  const screen = h(
    "div",
    { class: "scan" },
    video,
    guide,
    h(
      "div",
      { class: "scan__top" },
      h("a", { class: "scan__btn", href: "#/cards", "aria-label": t.common.close }, "✕"),
      variantBtn,
      torchBtn,
    ),
    h("div", { class: "scan__bottom" }, status, chooser, tray),
  );
  root.append(screen);

  let stream: MediaStream | null = null;
  let stopped = false;
  const stop = () => {
    stopped = true;
    stream?.getTracks().forEach((track) => track.stop());
    window.removeEventListener("hashchange", stop);
  };
  window.addEventListener("hashchange", stop);

  // --- přidané karty ---------------------------------------------------------
  let last: Added | null = null;
  const renderTray = () => {
    if (!last || last.undone) {
      tray.replaceChildren();
      return;
    }
    const { card, variant: v } = last;
    const entry = last;
    const price = h("strong", null, "…");
    cardInfo(card.id).then((info) => (price.textContent = priceLabel(variantPrice(info?.price, v))));
    const count = realCounts(card.id)[v] ?? 0;
    tray.replaceChildren(
      h("img", { class: "scan__thumb", src: `${card.image}/low.webp`, alt: "" }),
      h(
        "div",
        { class: "scan__info" },
        h("strong", null, card.name),
        h("span", { class: "muted small" }, `${card.setName} · #${card.number}${v === "reverse" ? " · RH" : ""}`),
        h("span", null, price, h("span", { class: "muted small" }, ` · ${t.scan.count(count)}`)),
      ),
      h(
        "button",
        {
          class: "btn",
          onclick: () => {
            addReal(card.id, v);
            renderTray();
          },
        },
        "+1",
      ),
      h(
        "button",
        {
          class: "btn",
          onclick: () => {
            addReal(card.id, v, -1);
            if ((realCounts(card.id)[v] ?? 0) === 0) entry.undone = true;
            renderTray();
          },
        },
        t.scan.undo,
      ),
    );
  };

  const add = (card: ScanCard) => {
    const entry: Added = { card, variant, undone: false };
    addReal(card.id, entry.variant);
    last = entry;
    navigator.vibrate?.(30);
    guide.classList.add("is-added");
    setTimeout(() => guide.classList.remove("is-added"), 500);
    renderTray();
    // karta, která jako reverse holo nevyšla, se přepíše na normální
    if (entry.variant === "reverse")
      cardInfo(card.id).then((info) => {
        if (info?.reverse !== false || entry.undone || (realCounts(card.id).reverse ?? 0) === 0) return;
        addReal(card.id, "reverse", -1);
        addReal(card.id, "normal");
        entry.variant = "normal";
        toast(t.scan.noReverse);
        if (last === entry) renderTray();
      });
  };

  // --- výběr z kandidátů -----------------------------------------------------
  let choosing = false;
  const choose = (title: string, cards: ScanCard[], done: () => void) => {
    choosing = true;
    const close = (card?: ScanCard) => {
      choosing = false;
      chooser.classList.add("hidden");
      chooser.replaceChildren();
      if (card) add(card);
      done();
    };
    chooser.replaceChildren(
      h("strong", null, title),
      h(
        "div",
        { class: "scan__options" },
        ...cards.map((card) =>
          h(
            "button",
            { class: "scan__option", onclick: () => close(card) },
            h("img", { src: `${card.image}/low.webp`, alt: "" }),
            h("span", null, card.name),
            h("span", { class: "muted small" }, `${card.setName} · #${card.number}`),
          ),
        ),
      ),
      h("button", { class: "btn", onclick: () => close() }, t.scan.none),
    );
    chooser.classList.remove("hidden");
  };

  // --- rozpoznávání ----------------------------------------------------------
  const canvas = document.createElement("canvas");
  canvas.width = FRAME_W;
  canvas.height = FRAME_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  /** Výřez z kamery kolem rámečku na obrazovce (video je roztažené přes obrazovku a oříznuté). */
  const grab = () => {
    const v = video.getBoundingClientRect();
    const g = guide.getBoundingClientRect();
    const scale = Math.max(v.width / video.videoWidth, v.height / video.videoHeight);
    const cx = (g.left + g.width / 2 - (v.left + v.width / 2)) / scale + video.videoWidth / 2;
    const cy = (g.top + g.height / 2 - (v.top + v.height / 2)) / scale + video.videoHeight / 2;
    const w = ((g.width / scale) * FRAME_W) / GUIDE_W;
    const hgt = ((g.height / scale) * FRAME_H) / GUIDE_H;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, FRAME_W, FRAME_H);
    ctx.drawImage(video, cx - w / 2, cy - hgt / 2, w, hgt, 0, 0, FRAME_W, FRAME_H);
    return ctx.getImageData(0, 0, FRAME_W, FRAME_H);
  };

  let streakIndex = -1;
  let streak = 0;
  let emptyFrames = 0;
  let unsureFrames = 0;
  /** Karty, které jsou v záběru vyřízené (přidané nebo odmítnuté), dokud kartu hráč nevymění. */
  let handled = new Set<number>();

  const step = (index: ScanIndex, db: CardDb) => {
    const { candidates } = identify({ rgba: grab().data, w: FRAME_W, h: FRAME_H }, GUIDE, db);
    const best = candidates[0];
    const card = index.cards[best.index];
    const other = candidates.find((c) => index.cards[c.index].name !== card.name);
    const sure = best.score >= SURE && best.score - (other?.score ?? 0) >= MARGIN;
    guide.classList.toggle("is-sure", sure);

    if (best.score < EMPTY) {
      // karta zmizela ze záběru: další je nová
      if (++emptyFrames >= 3) handled = new Set();
      streak = 0;
      unsureFrames = 0;
      status.textContent = t.scan.aim;
      return;
    }
    emptyFrames = 0;
    if (handled.has(best.index)) {
      status.textContent = t.scan.next;
      return;
    }
    if (!sure) {
      streak = 0;
      status.textContent = t.scan.aim;
      if (++unsureFrames >= UNSURE_FRAMES && best.score >= SURE - 0.1) {
        unsureFrames = 0;
        const options = candidates.slice(0, 4);
        choose(
          t.scan.unsure,
          options.map((c) => index.cards[c.index]),
          () => (handled = new Set(options.map((c) => c.index))),
        );
      }
      return;
    }
    unsureFrames = 0;
    streak = best.index === streakIndex ? streak + 1 : 1;
    streakIndex = best.index;
    if (streak < CONFIRM) return;
    streak = 0;
    const twins = candidates.filter((c) => index.cards[c.index].name === card.name && c.score >= best.score - TWIN);
    handled = new Set(twins.map((c) => c.index));
    if (twins.length > 1)
      choose(
        t.scan.which,
        twins.map((c) => index.cards[c.index]),
        () => {},
      );
    else add(card);
    status.textContent = t.scan.next;
  };

  const run = async () => {
    status.textContent = t.scan.loading(0);
    const dbLoad = loadScanDb((done) => {
      if (!stopped && done < 1 && !screen.classList.contains("scan--error")) status.textContent = t.scan.loading(Math.round(done * 100));
    });
    dbLoad.catch(() => undefined);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("no camera", "NotFoundError");
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (err) {
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      status.textContent = denied ? t.scan.denied : t.scan.noCamera;
      screen.classList.add("scan--error");
      return;
    }
    if (stopped) return stop();
    video.srcObject = stream;
    await video.play().catch(() => undefined);

    // světlo telefonu, kde ho prohlížeč umí ovládat
    const track = stream.getVideoTracks()[0];
    const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
    if (caps.torch) {
      let on = false;
      torchBtn.classList.remove("hidden");
      torchBtn.addEventListener("click", () => {
        on = !on;
        track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => undefined);
        torchBtn.classList.toggle("is-on", on);
      });
    }

    let loaded: { index: ScanIndex; db: CardDb };
    try {
      loaded = await dbLoad;
    } catch {
      status.textContent = t.scan.dbError;
      screen.classList.add("scan--error");
      return;
    }
    status.textContent = t.scan.aim;
    while (!stopped && screen.isConnected) {
      if (!choosing && !document.hidden && video.readyState >= 2 && video.videoWidth) step(loaded.index, loaded.db);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    stop();
  };
  run();
}
