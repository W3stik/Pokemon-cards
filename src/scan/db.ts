// Databáze skeneru (public/data/scan, vyrábí scripts/build-scan-db.mjs): seznam všech
// anglických karet s obrázkem, jejich otisky a šedé náhledy. Seznam karet (index) je malý
// a používá ho i album Moje karty; otisky a náhledy (asi 10 MB) se stahují až pro skener.
import { FP_LEN } from "./fingerprint";
import type { CardDb } from "./match";
import { REF_H, REF_W } from "./verify";

export interface ScanCard {
  /** Id karty v TCGdex („sv08-057“). */
  id: string;
  name: string;
  /** Číslo v sadě tak, jak ho uvádí TCGdex („057“, „TG12“). */
  number: string;
  setId: string;
  setName: string;
  year: number;
  /** Adresa obrázku bez přípony: + „/low.webp“ (náhled) nebo „/high.webp“. */
  image: string;
}

interface IndexFile {
  version: number;
  count: number;
  atlasCols: number;
  atlasRows: number;
  atlases: number;
  sets: { id: string; name: string; serie: string; year: number; base: string; cards: [string, string][] }[];
}

export interface ScanIndex {
  /** Karty v pořadí databáze (pořadí = pozice otisku a náhledu). */
  cards: ScanCard[];
  byId: Map<string, ScanCard>;
  file: IndexFile;
}

const BASE = `${import.meta.env.BASE_URL}data/scan/`;

let index: Promise<ScanIndex> | null = null;

/** Seznam karet, které skener zná. */
export function loadScanIndex(): Promise<ScanIndex> {
  index ??= fetch(`${BASE}index.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<IndexFile>;
    })
    .then((file) => {
      const cards: ScanCard[] = [];
      for (const set of file.sets)
        for (const [number, name] of set.cards)
          cards.push({ id: `${set.id}-${number}`, name, number, setId: set.id, setName: set.name, year: set.year, image: `${set.base}/${number}` });
      return { cards, byId: new Map(cards.map((c) => [c.id, c])), file };
    })
    .catch((err) => {
      index = null;
      throw err;
    });
  return index;
}

/** Šedé náhledy z jednoho archu (obrázek WebP s dlaždicemi REF_W×REF_H). */
async function atlasRefs(url: string, cols: number, count: number, out: Uint8Array, offset: number) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const image = await createImageBitmap(await res.blob());
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  image.close();
  const { data, width } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < count; i++) {
    const x0 = (i % cols) * REF_W;
    const y0 = Math.floor(i / cols) * REF_H;
    const o = offset + i * REF_W * REF_H;
    for (let y = 0; y < REF_H; y++) for (let x = 0; x < REF_W; x++) out[o + y * REF_W + x] = data[((y0 + y) * width + x0 + x) * 4];
  }
}

let full: Promise<{ index: ScanIndex; db: CardDb }> | null = null;

/** Celá databáze pro skener; `onProgress` dostává podíl staženého (0–1). */
export function loadScanDb(onProgress: (done: number) => void = () => {}): Promise<{ index: ScanIndex; db: CardDb }> {
  full ??= (async () => {
    const idx = await loadScanIndex();
    const { count, atlases, atlasCols, atlasRows } = idx.file;
    const perAtlas = atlasCols * atlasRows;
    let done = 0;
    const step = () => onProgress(++done / (atlases + 1));
    const fpsLoad = fetch(`${BASE}fps.bin`).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fps = new Int8Array(await res.arrayBuffer());
      if (fps.length !== count * FP_LEN) throw new Error("fps.bin");
      step();
      return fps;
    });
    const refs = new Uint8Array(count * REF_W * REF_H);
    const refsLoad = Promise.all(
      Array.from({ length: atlases }, (_, a) =>
        atlasRefs(`${BASE}refs-${a}.webp`, atlasCols, Math.min(perAtlas, count - a * perAtlas), refs, a * perAtlas * REF_W * REF_H).then(step),
      ),
    );
    const [fps] = await Promise.all([fpsLoad, refsLoad]);
    return { index: idx, db: { count, fps, refs } };
  })().catch((err) => {
    full = null;
    throw err;
  });
  return full;
}
