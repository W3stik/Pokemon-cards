// Otisk karty pro skener: z obrázku karty zmenšeného na 32×32 udělá 96 čísel, která se
// při jiném světle, ostrosti a drobném posunu mění málo, ale mezi kartami se liší.
//  - jas: průměr a kontrast se vyrovnají, pak nízké frekvence (DCT 8×8 bez stejnosměrné
//    složky) → 63 čísel normovaných na jednotkovou délku
//  - barva: nízké frekvence (DCT 4×4) obou barevných složek v jednotkách kontrastu jasu
// Čistá funkce bez DOM: používá ji aplikace i skript, který otisky všech karet vyrábí.

/** Strana čtverce, na který se karta před výpočtem zmenší (poměr stran se zahodí). */
export const FP_SIZE = 32;
/** Délka otisku v bajtech. */
export const FP_LEN = 96;
const Y_LEN = 63;
const C_OFFSET = 64;

// cos tabulka ortonormální DCT-II pro N = 32, jen prvních 8 frekvencí
const COS = new Float32Array(8 * FP_SIZE);
for (let k = 0; k < 8; k++) {
  const scale = Math.sqrt((k === 0 ? 1 : 2) / FP_SIZE);
  for (let n = 0; n < FP_SIZE; n++) COS[k * FP_SIZE + n] = scale * Math.cos((Math.PI * (2 * n + 1) * k) / (2 * FP_SIZE));
}

/** Nízké frekvence roviny 32×32: `size`×`size` koeficientů po řádcích. */
function dctLow(plane: Float32Array, size: number, out: Float32Array) {
  const rows = new Float32Array(FP_SIZE * size);
  for (let y = 0; y < FP_SIZE; y++)
    for (let k = 0; k < size; k++) {
      let s = 0;
      for (let x = 0; x < FP_SIZE; x++) s += plane[y * FP_SIZE + x] * COS[k * FP_SIZE + x];
      rows[y * size + k] = s;
    }
  for (let ky = 0; ky < size; ky++)
    for (let kx = 0; kx < size; kx++) {
      let s = 0;
      for (let y = 0; y < FP_SIZE; y++) s += rows[y * size + kx] * COS[ky * FP_SIZE + y];
      out[ky * size + kx] = s;
    }
}

const clamp8 = (v: number) => Math.max(-127, Math.min(127, Math.round(v)));

/** Otisk z pixelů RGBA obrázku 32×32 (karta roztažená na čtverec). */
export function fingerprint(rgba: Uint8ClampedArray | Uint8Array): Int8Array {
  const n = FP_SIZE * FP_SIZE;
  const Y = new Float32Array(n);
  const Cb = new Float32Array(n);
  const Cr = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    Y[i] = y;
    Cb[i] = b - y;
    Cr[i] = r - y;
    mean += y;
  }
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    Y[i] -= mean;
    variance += Y[i] * Y[i];
  }
  const std = Math.sqrt(variance / n) || 1;

  const out = new Int8Array(FP_LEN);
  const yc = new Float32Array(64);
  dctLow(Y, 8, yc);
  let norm = 0;
  for (let i = 1; i < 64; i++) norm += yc[i] * yc[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < Y_LEN; i++) out[i] = clamp8((yc[i + 1] / norm) * 250);

  const cc = new Float32Array(16);
  const chroma = 80 / (FP_SIZE * std);
  dctLow(Cb, 4, cc);
  for (let i = 0; i < 16; i++) out[C_OFFSET + i] = clamp8(cc[i] * chroma);
  dctLow(Cr, 4, cc);
  for (let i = 0; i < 16; i++) out[C_OFFSET + 16 + i] = clamp8(cc[i] * chroma);
  return out;
}

/** Vzdálenost dvou otisků (menší = podobnější); `b` je část velkého pole od `offset`. */
export function fpDistance(a: Int8Array, b: Int8Array, offset = 0, chromaWeight = 1): number {
  let dy = 0;
  for (let i = 0; i < Y_LEN; i++) {
    const d = a[i] - b[offset + i];
    dy += d * d;
  }
  let dc = 0;
  for (let i = C_OFFSET; i < FP_LEN; i++) {
    const d = a[i] - b[offset + i];
    dc += d * d;
  }
  return dy + chromaWeight * dc;
}
