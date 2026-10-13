// Efekty odhalení vzácné karty při otevírání balíčku. Síla se stupňuje podle „úrovně“
// (tier) odvozené z ranku rarity:
//   1 Double Rare, ACE SPEC, V, VMAX …     tlaková vlna, hvězdičky
//   2 Illustration / Ultra Rare, alt art …  + paprsky, větší hvězdičky
//   3 Special Illustration Rare, rainbow    + reflektor, nápis rarity, barevný záblesk
//   4 zlaté karty, BWR, alt art VMAX …      + zlaté paprsky, déšť zlatých hvězd, otřes
import { h } from "./dom";

export type Tier = 0 | 1 | 2 | 3 | 4;

export const tierOf = (rank: number): Tier => (rank >= 9 ? 4 : rank >= 8 ? 3 : rank >= 6 ? 2 : rank >= 4 ? 1 : 0);

/** Jak dlouho se karta před otočením „nabíjí“ (ms) – čím vzácnější, tím déle. */
export const CHARGE_MS: Record<Tier, number> = { 0: 0, 1: 280, 2: 520, 3: 800, 4: 1050 };

const GOLD = "#ffd65a";
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const later = (el: Element, ms: number) => setTimeout(() => el.remove(), ms);

/** Tlaková vlna: rozpínající se prstenec z karty (u vzácnějších dvojitý). */
export function shockwave(item: HTMLElement, color: string, tier: Tier) {
  const rings = tier >= 3 ? 2 : 1;
  for (let i = 0; i < rings; i++) {
    const ring = h("div", { class: "shockwave", style: `--c: ${tier >= 4 ? GOLD : color}; animation-delay: ${i * 140}ms` });
    item.append(ring);
    later(ring, 1100 + i * 140);
  }
}

/** Hvězdičky rozletující se z karty, třpytí se a pomalu dohasínají. */
export function stars(item: HTMLElement, color: string, tier: Tier) {
  const n = [0, 14, 22, 34, 46][tier];
  const palette = tier >= 4 ? [GOLD, "#fff3b0", "#ffffff", "#ffb800"] : [color, "#ffffff", color, "#fff3b0"];
  const layer = h("div", { class: "stars" });
  for (let i = 0; i < n; i++) {
    const angle = rand(0, Math.PI * 2);
    const dist = rand(90, 150 + tier * 45);
    layer.append(
      h("i", {
        style:
          `--c: ${palette[i % palette.length]}; --dx: ${Math.cos(angle) * dist}px; --dy: ${Math.sin(angle) * dist - 30}px; ` +
          `--s: ${rand(6, 12 + tier * 3)}px; --t: ${rand(0.9, 1.6)}s; --d: ${rand(0, 0.15)}s`,
      }),
    );
  }
  item.append(layer);
  later(layer, 1900);
}

/** Paprsky světla za balíkem karet: dvě vrstvy otáčející se proti sobě. */
export function rays(pile: HTMLElement, color: string, tier: Tier) {
  pile.querySelector(".rays")?.remove();
  const el = h("div", { class: `rays${tier >= 4 ? " rays--gold" : ""}`, style: `--rc: ${color}` });
  pile.prepend(el);
  later(el, 2800);
}

/** Krátký záblesk v barvě rarity přes celou obrazovku. */
export function flash(color: string) {
  const el = h("div", { class: "flash flash--tinted", style: `--c: ${color}` });
  document.body.append(el);
  later(el, 800);
}

/** Velký nápis rarity nad kartou (SIR a vzácnější). */
export function rarityBanner(stage: HTMLElement, text: string, color: string, tier: Tier) {
  stage.querySelector(".rarity-banner")?.remove();
  const el = h("div", { class: `rarity-banner${tier >= 4 ? " rarity-banner--gold" : ""}`, style: `--c: ${color}` }, text);
  stage.append(el);
  later(el, 2600);
}

/** Déšť zlatých hvězd přes scénu (zlaté karty a BWR). */
export function goldRain(stage: HTMLElement) {
  const layer = h("div", { class: "gold-rain" });
  for (let i = 0; i < 36; i++) {
    layer.append(
      h("i", {
        style: `left: ${rand(0, 100)}%; --s: ${rand(6, 14)}px; --t: ${rand(1.6, 2.6)}s; --d: ${rand(0, 0.9)}s; --sway: ${rand(-40, 40)}px`,
      }),
    );
  }
  stage.append(layer);
  later(layer, 3600);
}

/** Otřes balíku karet. */
export function shake(pile: HTMLElement) {
  pile.classList.add("is-shake");
  setTimeout(() => pile.classList.remove("is-shake"), 600);
}
