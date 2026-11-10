// Rozpoznání karty ze snímku kamery. Postup:
//  1. hrubý otisk z několika výřezů kolem rámečku → nejpodobnější karty z databáze
//  2. pár nejlepších se přiloží na snímek z několika natočení; karty mají společné
//     rozvržení (rám, textové pole), takže i nepřesný kandidát najde, kde karta leží
//  3. z narovnaného výřezu se otisk spočítá znovu → lepší seznam kandidátů
//  4. všichni kandidáti se přiloží z nalezené polohy a seřadí podle shody
// Čisté funkce bez DOM; stejným kódem se vyrábí i databáze (otisk a náhled z obrázku karty).
import { fingerprint, FP_LEN, FP_SIZE } from "./fingerprint";
import { type Gray, grayDown, type Placement, REF_H, REF_W, register } from "./verify";

export interface Frame {
  rgba: Uint8ClampedArray | Uint8Array;
  w: number;
  h: number;
}

export interface CardDb {
  count: number;
  /** Otisky: count × FP_LEN. */
  fps: Int8Array;
  /** Šedé náhledy: count × REF_W × REF_H. */
  refs: Uint8Array;
}

export interface Candidate {
  index: number;
  score: number;
}

/** Vzorků na buňku v každém směru (průměrování místo jednoho bodu, jinak by obraz zrnil). */
const SS = 4;

/** Výřez snímku daný umístěním karty, převzorkovaný na outW×outH (RGBA). */
export function sampleRgba(frame: Frame, p: Placement, outW: number, outH: number): Uint8ClampedArray {
  const { rgba, w, h } = frame;
  const [cx, cy, ax, ay, bx, by] = p;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const n = SS * SS;
  for (let v = 0; v < outH; v++)
    for (let u = 0; u < outW; u++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sv = 0; sv < SS; sv++) {
        const fv = (v + (sv + 0.5) / SS) / outH - 0.5;
        for (let su = 0; su < SS; su++) {
          const fu = (u + (su + 0.5) / SS) / outW - 0.5;
          let x = Math.round(cx + ax * fu + bx * fv - 0.5);
          let y = Math.round(cy + ay * fu + by * fv - 0.5);
          x = x < 0 ? 0 : x >= w ? w - 1 : x;
          y = y < 0 ? 0 : y >= h ? h - 1 : y;
          const i = (y * w + x) * 4;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
        }
      }
      const o = (v * outW + u) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  return out;
}

/** Umístění přes celý obrázek (pro výrobu databáze z obrázku karty). */
export const wholeImage = (w: number, h: number): Placement => [w / 2, h / 2, w, 0, 0, h];

/** Otisk a šedý náhled karty z jejího obrázku (položka databáze). */
export function describeCard(image: Frame): { fp: Int8Array; ref: Uint8Array } {
  const p = wholeImage(image.w, image.h);
  const small = sampleRgba(image, p, REF_W, REF_H);
  const ref = new Uint8Array(REF_W * REF_H);
  for (let i = 0; i < ref.length; i++) ref[i] = Math.round(0.299 * small[i * 4] + 0.587 * small[i * 4 + 1] + 0.114 * small[i * 4 + 2]);
  return { fp: fingerprint(sampleRgba(image, p, FP_SIZE, FP_SIZE)), ref };
}

const CHROMA_WEIGHT = 2;

/** Do `best` zapíše pro každou kartu menší z dosavadní a nové vzdálenosti otisku. */
function coarse(db: CardDb, fp: Int8Array, best: Float32Array) {
  const { fps, count } = db;
  for (let i = 0; i < count; i++) {
    const o = i * FP_LEN;
    let d = 0;
    for (let k = 0; k < 63; k++) {
      const x = fp[k] - fps[o + k];
      d += x * x;
    }
    let c = 0;
    for (let k = 64; k < FP_LEN; k++) {
      const x = fp[k] - fps[o + k];
      c += x * x;
    }
    d += CHROMA_WEIGHT * c;
    if (d < best[i]) best[i] = d;
  }
}

function topOf(best: Float32Array, count: number): number[] {
  const order = Array.from({ length: best.length }, (_, i) => i);
  order.sort((a, b) => best[a] - best[b]);
  return order.slice(0, count);
}

const rotated = (p: Placement, deg: number): Placement => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return [p[0], p[1], p[2] * c - p[3] * s, p[2] * s + p[3] * c, p[4] * c - p[5] * s, p[4] * s + p[5] * c];
};

const scaled = (p: Placement, k: number, dx = 0, dy = 0): Placement => [
  p[0] + dx * Math.hypot(p[2], p[3]),
  p[1] + dy * Math.hypot(p[4], p[5]),
  p[2] * k,
  p[3] * k,
  p[4] * k,
  p[5] * k,
];

export interface Identified {
  /** Kandidáti od nejlepší shody. */
  candidates: Candidate[];
  /** Kde karta ve snímku leží (v pixelech snímku). */
  placement: Placement;
}

/**
 * Pozná kartu ve snímku. `guide` je rámeček, do kterého hráč kartu zarovnává
 * (v pixelech snímku); karta v něm smí být trochu posunutá, natočená a jinak velká.
 */
export function identify(frame: Frame, guide: Placement, db: CardDb, top = 30): Identified {
  const best = new Float32Array(db.count).fill(Infinity);
  for (const k of [0.94, 1, 1.06])
    for (const dx of [-0.04, 0, 0.04])
      for (const dy of [-0.04, 0, 0.04]) coarse(db, fingerprint(sampleRgba(frame, scaled(guide, k, dx, dy), FP_SIZE, FP_SIZE)), best);
  const first = topOf(best, top);

  // zmenšený šedý snímek pro přikládání: karta v něm má na šířku asi dvojnásobek náhledu
  const factor = Math.max(1, Math.floor(Math.hypot(guide[2], guide[3]) / (REF_W * 1.9)));
  const gray: Gray = grayDown(frame.rgba, frame.w, frame.h, factor);
  const g = guide.map((v) => v / factor) as Placement;

  // kde karta leží: nejlepší přiložení několika prvních kandidátů z několika natočení
  let found = { score: -Infinity, placement: g };
  for (const index of first.slice(0, 6))
    for (const deg of [-5, 0, 5]) {
      const r = register(gray, db.refs, index * REF_W * REF_H, rotated(g, deg));
      if (r.score > found.score) found = r;
    }

  // otisk z narovnaného výřezu → doplnění kandidátů
  const exact = found.placement.map((v) => v * factor) as Placement;
  const second = new Float32Array(db.count).fill(Infinity);
  coarse(db, fingerprint(sampleRgba(frame, exact, FP_SIZE, FP_SIZE)), second);
  const pool = [...new Set([...topOf(second, top), ...first])];

  const candidates = pool
    .map((index) => ({ index, score: register(gray, db.refs, index * REF_W * REF_H, found.placement, 0.02).score }))
    .sort((a, b) => b.score - a.score);
  return { candidates, placement: exact };
}
