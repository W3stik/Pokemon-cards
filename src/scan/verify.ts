// Druhý stupeň skeneru: ověření kandidáta přiložením. Hrubý otisk (fingerprint.ts) vybere
// pár desítek podobných karet; tady se malý šedý náhled každé z nich „přiloží“ na snímek
// z kamery – hledá se posun, velikost, natočení a zkosení, při kterých sedí nejlíp – a
// spočítá se shoda. Správná karta sedne skoro přesně, cizí ne, takže skóre obě jasně oddělí.
// Shoda se počítá po blocích a nejhorší bloky se zahodí: odlesk nebo prst na kartě ji nezkazí.
// Čisté funkce bez DOM.

/** Rozměr šedého náhledu karty, proti kterému se ověřuje. */
export const REF_W = 32;
export const REF_H = 44;
const BLOCKS_X = 4;
const BLOCKS_Y = 4;
const BLOCK_W = REF_W / BLOCKS_X;
const BLOCK_H = REF_H / BLOCKS_Y;
const BLOCKS = BLOCKS_X * BLOCKS_Y;
/** Kolik nejlepších bloků se počítá (zbytek = odlesk, prst, stín). */
const KEEP = 12;

export interface Gray {
  data: Float32Array;
  w: number;
  h: number;
}

/** Šedý obraz zmenšený průměrováním (z pixelů RGBA), `factor` = kolikrát. */
export function grayDown(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, factor: number): Gray {
  const ow = Math.floor(w / factor);
  const oh = Math.floor(h / factor);
  const data = new Float32Array(ow * oh);
  const area = factor * factor;
  for (let oy = 0; oy < oh; oy++)
    for (let ox = 0; ox < ow; ox++) {
      let s = 0;
      for (let y = 0; y < factor; y++) {
        let i = ((oy * factor + y) * w + ox * factor) * 4;
        for (let x = 0; x < factor; x++, i += 4) s += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      }
      data[oy * ow + ox] = s / area;
    }
  return { data, w: ow, h: oh };
}

/** Šedý náhled karty REF_W×REF_H z pixelů RGBA téhož rozměru (0–255). */
export function refGray(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(REF_W * REF_H);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
  return out;
}

/** Umístění karty ve snímku: střed a dva vektory stran (afinní zobrazení). */
export type Placement = [cx: number, cy: number, ax: number, ay: number, bx: number, by: number];

const sample = new Float32Array(REF_W * REF_H);
const blockScore = new Float32Array(BLOCKS);

/** Shoda náhledu s místem ve snímku: průměr korelací nejlepších bloků (−1…1). */
function score(frame: Gray, ref: Uint8Array, refOffset: number, p: Placement): number {
  const { data, w, h } = frame;
  const [cx, cy, ax, ay, bx, by] = p;
  for (let v = 0; v < REF_H; v++) {
    const fv = (v + 0.5) / REF_H - 0.5;
    for (let u = 0; u < REF_W; u++) {
      const fu = (u + 0.5) / REF_W - 0.5;
      let x = cx + ax * fu + bx * fv;
      let y = cy + ay * fu + by * fv;
      x = x < 0 ? 0 : x > w - 1.001 ? w - 1.001 : x;
      y = y < 0 ? 0 : y > h - 1.001 ? h - 1.001 : y;
      const x0 = x | 0;
      const y0 = y | 0;
      const tx = x - x0;
      const ty = y - y0;
      const i = y0 * w + x0;
      sample[v * REF_W + u] =
        (data[i] * (1 - tx) + data[i + 1] * tx) * (1 - ty) + (data[i + w] * (1 - tx) + data[i + w + 1] * tx) * ty;
    }
  }
  for (let b = 0; b < BLOCKS; b++) {
    const x0 = (b % BLOCKS_X) * BLOCK_W;
    const y0 = Math.floor(b / BLOCKS_X) * BLOCK_H;
    let ss = 0;
    let sr = 0;
    let srr = 0;
    let sqq = 0;
    let srq = 0;
    for (let y = y0; y < y0 + BLOCK_H; y++)
      for (let x = x0; x < x0 + BLOCK_W; x++) {
        const q = sample[y * REF_W + x];
        const r = ref[refOffset + y * REF_W + x];
        ss += q;
        sr += r;
        sqq += q * q;
        srr += r * r;
        srq += q * r;
      }
    const n = BLOCK_W * BLOCK_H;
    const varQ = sqq - (ss * ss) / n;
    const varR = srr - (sr * sr) / n;
    // jednolitý blok (bez kresby) nic neříká: neutrální hodnota
    blockScore[b] = varR < n * 16 || varQ < n ? 0 : (srq - (ss * sr) / n) / Math.sqrt(varQ * varR);
  }
  blockScore.sort();
  let total = 0;
  for (let b = BLOCKS - KEEP; b < BLOCKS; b++) total += blockScore[b];
  return total / KEEP;
}

/**
 * Přiloží náhled karty na snímek: z výchozího umístění (rámeček) postupně zkouší malé
 * změny posunu, velikosti, natočení a zkosení a nechává si ty, které shodu zlepší.
 * `firstStep` = první krok jako díl šířky karty (menší, když je poloha už skoro známá).
 */
export function register(
  frame: Gray,
  ref: Uint8Array,
  refOffset: number,
  start: Placement,
  firstStep = 0.08,
): { score: number; placement: Placement } {
  const p = start.slice() as Placement;
  const size = Math.hypot(start[2], start[3]);
  let best = score(frame, ref, refOffset, p);
  for (let step = firstStep; step >= 0.004; step /= 2) {
    for (let pass = 0; pass < 3; pass++) {
      let improved = false;
      for (let k = 0; k < 6; k++) {
        const delta = size * step * (k < 2 ? 1 : 0.7);
        for (const dir of [1, -1]) {
          p[k] += dir * delta;
          const s = score(frame, ref, refOffset, p);
          if (s > best) {
            best = s;
            improved = true;
            break;
          }
          p[k] -= dir * delta;
        }
      }
      if (!improved) break;
    }
  }
  return { score: best, placement: p };
}
