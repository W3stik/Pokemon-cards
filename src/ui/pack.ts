import { packProfile, packSize } from "../odds";
import type { SetInfo } from "../types";
import { h } from "./dom";
import { enableTilt } from "./holo";

/**
 * Produkty „Booster Pack“ v katalogu TCGplayer (productId). Fotky obalů se
 * načítají z jejich CDN; ID jsou z exportu katalogu na tcgcsv.com.
 */
export const PACK_PRODUCTS: Record<string, number> = {
  sv10: 624683,
  zsv10pt5: 630434,
  rsv10pt5: 630699,
  me1: 644352,
  me2: 654144,
  me2pt5: 672434,
  me3: 672398,
  me4: 684446,
  me5: 692944,
  me55: 696613,
  sv9: 610935,
  sv8pt5: 593294,
  sv8: 565604,
  sv7: 557331,
  sv6pt5: 552997,
  sv6: 543843,
  sv5: 532841,
  sv4pt5: 528038,
  sv4: 512822,
  sv3pt5: 504467,
  sv3: 501256,
  sv2: 493976,
  sv1: 476451,
  swsh7: 244337,
};

export function packArtUrl(setId: string, large = false): string | null {
  const id = PACK_PRODUCTS[setId];
  if (!id) return null;
  return `https://tcgplayer-cdn.tcgplayer.com/product/${id}_${large ? "in_1000x1000" : "400w"}.jpg`;
}

/** Velkou fotku obalu stáhne dopředu, aby otevírání balíčku nečekalo. */
export function prefetchPackArt(setId: string) {
  const url = packArtUrl(setId, true);
  if (url) new Image().src = url;
}

// Poměr stran fotky obalu si pamatujeme, aby balíček při načítání neposkočil.
const RATIO_KEY = "pokemon-packs:pack-ratios";
const ratios: Record<string, number> = (() => {
  try {
    return JSON.parse(localStorage.getItem(RATIO_KEY) ?? "{}");
  } catch {
    return {};
  }
})();

function rememberRatio(setId: string, ratio: number) {
  if (Math.abs((ratios[setId] ?? 0) - ratio) < 0.001) return;
  ratios[setId] = ratio;
  try {
    localStorage.setItem(RATIO_KEY, JSON.stringify(ratios));
  } catch {
    // nevadí
  }
}

/**
 * Lehký náhled balíčku pro seznamy (obchod, inventář): jen fotka s nakláněním
 * a odleskem pod kurzorem. 3D model z CSS vrstev u desítek balíčků naráz zatěžoval
 * telefon; plnohodnotný balíček je na regálu a při otevírání.
 */
export function packThumb(set: SetInfo): HTMLElement {
  const art = packArtUrl(set.id);
  const ratio = ratios[set.id] ?? 0.55;
  const fallback = () =>
    h("div", { class: "packthumb__fallback", style: `--c1: ${packProfile(set.id).colors[0]}; --c2: ${packProfile(set.id).colors[1]}` },
      h("img", { src: set.logo, alt: "", draggable: "false", loading: "lazy" }),
    );
  const el = h("div", { class: "packthumb", style: `--ratio: ${ratio}`, role: "img", "aria-label": `Balíček ${set.name}` });
  if (art) {
    const img = h("img", { class: "packthumb__img", src: art, alt: "", draggable: "false", loading: "lazy", decoding: "async" });
    img.addEventListener("load", () => {
      const r = img.naturalWidth / img.naturalHeight;
      el.style.setProperty("--ratio", String(r));
      rememberRatio(set.id, r);
    });
    img.addEventListener("error", () => img.replaceWith(fallback()));
    el.append(img);
  } else {
    el.append(fallback());
  }
  el.append(h("div", { class: "packthumb__glare" }));
  enableTilt(el, { gyro: false });
  return el;
}

/**
 * Zadní strana obalu: fotku rubu nemáme, proto vlastní potisk v barvách sady
 * (zatavené okraje, šev uprostřed, logo sady). Kreslí se celá na obou dílech
 * obalu (pruh i zbytek), takže na sebe přesně navazují.
 */
function backDesign(set: SetInfo): HTMLElement {
  return h(
    "div",
    { class: "pack3d__backdesign" },
    h("img", { class: "pack3d__backlogo", src: set.logo, alt: "", draggable: "false", loading: "lazy" }),
    h("div", { class: "pack3d__backlabel" }, `${set.name} · ${packSize(packProfile(set.id))} karet`),
  );
}

/** Náhradní potisk, když fotka obalu chybí nebo se nenačte. */
function fallbackArt(set: SetInfo): HTMLElement {
  return h(
    "div",
    { class: "pack3d__fallback" },
    h("div", { class: "pack__series" }, set.series),
    h("img", { class: "pack__logo", src: set.logo, alt: "", draggable: "false" }),
    h("div", { class: "pack__label" }, `Booster Pack · ${packSize(packProfile(set.id))} karet`),
  );
}

/**
 * 3D balíček: přední a zadní strana, boky a odtrhávací horní pruh.
 * Obě části (pruh i zbytek) kreslí stejný obrázek, jen každá jeho jiný výřez,
 * takže při roztržení se obal opravdu rozdělí.
 */
export function packEl(set: SetInfo, opts: { large?: boolean; tilt?: boolean; hint?: number } = {}): HTMLElement {
  const [c1, c2] = packProfile(set.id).colors;
  // Nejdřív malá fotka (bývá už v mezipaměti z obchodu), velká ji vymění, až se načte.
  const art = packArtUrl(set.id);
  const ratio = ratios[set.id];
  const face = (side: "front" | "back") =>
    h(
      "div",
      { class: `pack3d__face pack3d__face--${side}` },
      side === "front" ? fallbackArt(set) : backDesign(set),
    );
  const mainFront = face("front");
  if (opts.hint) mainFront.append(twinkle(opts.hint));

  const pack = h(
    "div",
    {
      class: `pack3d${art ? "" : " pack3d--noart"}`,
      style: `--c1: ${c1}; --c2: ${c2};${art ? ` --art: url("${art}");` : ""}${ratio ? ` --ratio: ${ratio};` : ""}`,
      role: "img",
      "aria-label": `Balíček ${set.name}`,
    },
    h(
      "div",
      { class: "pack3d__tilt" },
      h(
        "div",
        { class: "pack3d__body" },
        h(
          "div",
          { class: "pack3d__piece pack3d__piece--top" },
          face("front"),
          face("back"),
          // I pruh má boky, jinak jsou z boku vidět dvě oddělené hrany (přední a zadní strana).
          h("div", { class: "pack3d__side pack3d__side--left" }),
          h("div", { class: "pack3d__side pack3d__side--right" }),
        ),
        h(
          "div",
          { class: "pack3d__piece pack3d__piece--main" },
          mainFront,
          face("back"),
          h("div", { class: "pack3d__side pack3d__side--left" }),
          h("div", { class: "pack3d__side pack3d__side--right" }),
        ),
      ),
    ),
    h("div", { class: "pack3d__shadow" }),
  );

  if (art) {
    // Poměr stran podle skutečné fotky; při chybě zůstane náhradní potisk.
    const img = new Image();
    img.onload = () => {
      const r = img.naturalWidth / img.naturalHeight;
      pack.style.setProperty("--ratio", String(r));
      rememberRatio(set.id, r);
    };
    img.onerror = () => pack.classList.add("pack3d--noart");
    img.src = art;
  }
  const largeArt = opts.large ? packArtUrl(set.id, true) : null;
  if (largeArt) {
    const big = new Image();
    big.src = largeArt;
    big
      .decode()
      .then(() => {
        pack.style.setProperty("--art", `url("${largeArt}")`);
        pack.classList.remove("pack3d--noart");
      })
      .catch(() => {
        // Zůstane malá fotka (nebo náhradní potisk).
      });
  }
  if (opts.tilt) enableTilt(pack);
  return pack;
}

/**
 * Tajný náznak vzácné karty: drobná jiskřička, která jednou za čas
 * problikne na náhodném místě obalu. Čím vzácnější karta, tím častěji a barevněji.
 */
function twinkle(level: number): HTMLElement {
  const period = [0, 7.5, 5.5, 3.8][level];
  const x = 18 + Math.random() * 64;
  const y = 22 + Math.random() * 60;
  return h("div", {
    class: `pack3d__twinkle pack3d__twinkle--${level}`,
    style: `left: ${x}%; top: ${y}%; animation-duration: ${period}s; animation-delay: ${-Math.random() * period}s`,
  });
}

const dateFmt = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: "numeric" });
export const formatDate = (iso: string) => dateFmt.format(new Date(`${iso}T12:00:00`));
