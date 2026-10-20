// Efekty odhalení vzácné karty při otevírání balíčku. Moderní měkké světlo místo ostrých
// tvarů: zář a světelný prach, široké měkké kužely světla, barevné pozadí s rozmazanými
// světly (bokeh). Měkkost dělají přechody barev, ne filtry (blur by telefon zpomaloval).
// Síla se stupňuje podle „úrovně“ (tier) odvozené z ranku rarity:
//   1 Double Rare, ACE SPEC, V, VMAX …     výdech světla, světelný prach
//   2 Illustration / Ultra Rare, alt art …  + kužely světla, víc prachu
//   3 Special Illustration Rare, rainbow    + barevné pozadí s bokehem, nápis rarity, zář
//   4 zlaté karty, BWR, alt art VMAX …      + zlaté kužely, zlaté třpytky, jemný otřes
import { h } from "./dom";

export type Tier = 0 | 1 | 2 | 3 | 4;

export const tierOf = (rank: number): Tier => (rank >= 9 ? 4 : rank >= 8 ? 3 : rank >= 6 ? 2 : rank >= 4 ? 1 : 0);

/** Délka zvuku napětí podle úrovně (ukázky zvuků v nastavení). */
export const CHARGE_MS: Record<Tier, number> = { 0: 0, 1: 280, 2: 520, 3: 800, 4: 1050 };

const GOLD = "#ffd65a";
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const later = (el: Element, ms: number) => setTimeout(() => el.remove(), ms);

/** Výdech světla z karty: měkká zář a tenký zářící kruh (u vzácnějších dva). */
export function shockwave(item: HTMLElement, color: string, tier: Tier) {
  const c = tier >= 4 ? GOLD : color;
  const bloom = h("div", { class: "fx-bloom", style: `--c: ${c}` });
  item.append(bloom);
  later(bloom, 1200);
  const rings = tier >= 3 ? 2 : 1;
  for (let i = 0; i < rings; i++) {
    const ring = h("div", { class: "fx-ring", style: `--c: ${c}; animation-delay: ${i * 160}ms` });
    item.append(ring);
    later(ring, 1300 + i * 160);
  }
}

/** Světelný prach: drobné zářící tečky a krátké stopy od okrajů karty, vznášejí se nahoru. */
export function stars(item: HTMLElement, color: string, tier: Tier) {
  const n = [0, 18, 28, 40, 54][tier];
  const palette = tier >= 4 ? [GOLD, "#fff3c4", "#ffffff"] : [color, "#ffffff", color];
  const layer = h("div", { class: "fx-dust" });
  for (let i = 0; i < n; i++) {
    // start na obvodu karty (elipsa), směr ven a trochu nahoru
    const angle = rand(0, Math.PI * 2);
    const dist = rand(40, 110 + tier * 30);
    const streak = Math.random() < 0.35;
    layer.append(
      h("i", {
        class: streak ? "is-streak" : "",
        style:
          `--c: ${palette[i % palette.length]}; left: ${50 + Math.cos(angle) * 50}%; top: ${50 + Math.sin(angle) * 50}%; ` +
          `--dx: ${Math.cos(angle) * dist}px; --dy: ${Math.sin(angle) * dist - rand(30, 90)}px; ` +
          `--a: ${(angle * 180) / Math.PI}deg; --s: ${rand(2, 4.5 + tier * 0.6)}px; ` +
          `--t: ${rand(1.1, 2.1)}s; --d: ${rand(0, 0.25)}s`,
      }),
    );
  }
  item.append(layer);
  later(layer, 2600);
}

/** Široké měkké kužely světla za kartou, pomalu se otáčejí a doznívají. */
export function rays(pile: HTMLElement, color: string, tier: Tier) {
  pile.querySelector(".fx-rays")?.remove();
  const el = h("div", { class: `fx-rays${tier >= 4 ? " fx-rays--gold" : ""}`, style: `--rc: ${color}` });
  pile.prepend(el);
  later(el, 3200);
}

/** Barevná zář z karty přes scénu (místo bílého záblesku). */
export function flash(color: string) {
  const el = h("div", { class: "fx-glow", style: `--c: ${color}` });
  document.body.append(el);
  later(el, 900);
}

/** Nápis rarity nad kartou (SIR a vzácnější): vyjede z rozmazání, přejede ho světlo. */
export function rarityBanner(stage: HTMLElement, text: string, color: string, tier: Tier) {
  stage.querySelector(".rarity-banner")?.remove();
  const el = h("div", { class: `rarity-banner${tier >= 4 ? " rarity-banner--gold" : ""}`, style: `--c: ${color}` }, text);
  stage.append(el);
  later(el, 2800);
}

/** Barevné pozadí s pomalu plujícími rozmazanými světly (SIR a vzácnější). */
export function bokeh(stage: HTMLElement, color: string, tier: Tier) {
  stage.querySelector(".fx-bokeh")?.remove();
  const c = tier >= 4 ? GOLD : color;
  const layer = h("div", { class: "fx-bokeh", style: `--c: ${c}` });
  for (let i = 0; i < 9; i++) {
    layer.append(
      h("i", {
        style:
          `left: ${rand(5, 95)}%; top: ${rand(10, 90)}%; --s: ${rand(40, 140)}px; --o: ${rand(0.25, 0.6)}; ` +
          `--dx: ${rand(-40, 40)}px; --dy: ${rand(-60, -10)}px; --t: ${rand(2.4, 3.4)}s; --d: ${rand(0, 0.4)}s`,
      }),
    );
  }
  stage.append(layer);
  later(layer, 3400);
}

/** Zlaté třpytky v různé hloubce: blízké velké a měkké, vzdálené drobné a ostré. */
export function goldRain(stage: HTMLElement) {
  const layer = h("div", { class: "fx-glitter" });
  for (let i = 0; i < 44; i++) {
    const near = Math.random() < 0.25;
    layer.append(
      h("i", {
        class: near ? "is-near" : "",
        style:
          `left: ${rand(0, 100)}%; --s: ${near ? rand(10, 18) : rand(2, 5)}px; ` +
          `--t: ${near ? rand(1.8, 2.6) : rand(2.4, 3.6)}s; --d: ${rand(0, 1)}s; --sway: ${rand(-30, 30)}px`,
      }),
    );
  }
  stage.append(layer);
  later(layer, 4600);
}

/** Jemný otřes balíku karet. */
export function shake(pile: HTMLElement) {
  pile.classList.add("is-shake");
  setTimeout(() => pile.classList.remove("is-shake"), 500);
}
