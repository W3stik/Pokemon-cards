// Vyrobí databázi skeneru karet: pro každou anglickou kartu z TCGdex, která má obrázek,
// spočítá otisk a šedý náhled (stejným kódem jako aplikace, src/scan/match.ts) a uloží
//   public/data/scan/index.json   sady a karty v pořadí databáze
//   public/data/scan/fps.bin      otisky (počet karet × FP_LEN bajtů)
//   public/data/scan/refs-N.webp  šedé náhledy poskládané do archů (ATLAS_COLS × ATLAS_ROWS)
// Spouští se ručně po vydání nových sad:  npm run scan-db
// Obrázky (asi 400 MB) se stahují jednou do .scan-cache (není v gitu).
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { getJson, HEADERS, pool } from "./tcgdex.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".scan-cache");
const OUT = join(ROOT, "public", "data", "scan");
const API = "https://api.tcgdex.net/v2/en";
/** Série, které nejsou papírové karty (Pokémon TCG Pocket). */
const SKIP_SERIES = new Set(["tcgp"]);
const ATLAS_COLS = 64;
const ATLAS_ROWS = 32;
const PER_ATLAS = ATLAS_COLS * ATLAS_ROWS;
await mkdir(join(CACHE, "img"), { recursive: true });

const cached = async (file, make) => {
  const path = join(CACHE, file);
  if (existsSync(path)) return JSON.parse(await readFile(path, "utf8"));
  const data = await make();
  await writeFile(path, JSON.stringify(data));
  return data;
};
const fileOf = (id) => join(CACHE, "img", `${id.replace(/[^\w.-]/g, "_")}-low.webp`);
const have = (id) => existsSync(fileOf(id)) && statSync(fileOf(id)).size > 0;

// 1) sady a karty
const list = await cached("sets.json", () => getJson(`${API}/sets`));
const details = await pool(list, (s) => cached(`set-${s.id}.json`, () => getJson(`${API}/sets/${encodeURIComponent(s.id)}`)), 6);
const sets = [];
let withoutImage = 0;
for (const d of details) {
  if (d.error) {
    console.log("sada se nenačetla:", d.error);
    continue;
  }
  if (SKIP_SERIES.has(d.serie?.id)) continue;
  const base = `https://assets.tcgdex.net/en/${d.serie.id}/${d.id}`;
  const cards = [];
  for (const c of d.cards ?? []) {
    // adresa obrázku se v databázi neukládá, skládá se ze sady a čísla karty
    if (c.image === `${base}/${c.localId}`) cards.push({ id: c.id, localId: c.localId, name: c.name });
    else withoutImage++;
  }
  if (cards.length) sets.push({ id: d.id, name: d.name, serie: d.serie.name, year: Number(d.releaseDate?.slice(0, 4)) || 0, base, cards });
}
const all = sets.flatMap((s) => s.cards.map((c) => ({ ...c, url: `${s.base}/${c.localId}/low.webp` })));
console.log(`${sets.length} sad, ${all.length} karet s obrázkem (${withoutImage} bez obrázku vynecháno)`);

// 2) obrázky
let done = 0;
const failed = (
  await pool(
    all,
    async (c) => {
      if (!have(c.id)) {
        const res = await fetch(c.url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await writeFile(fileOf(c.id), Buffer.from(await res.arrayBuffer()));
      }
      if (++done % 2000 === 0) console.log(`  obrázky ${done}/${all.length}`);
    },
    12,
  )
).filter((r) => r?.error).length;
if (failed) console.log(`nestaženo ${failed} obrázků – tyto karty v databázi nebudou`);
for (const s of sets) s.cards = s.cards.filter((c) => have(c.id));
const cards = sets.flatMap((s) => s.cards);

// 3) otisky a náhledy v prohlížeči (dekódování WebP + kód aplikace přes Vite)
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 5198 } });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route("**/scan-img/**", async (route) => {
  const id = decodeURIComponent(route.request().url().split("/scan-img/")[1]);
  route.fulfill({ body: await readFile(fileOf(id)), contentType: "image/webp" });
});
await page.goto(server.resolvedUrls.local[0] + "src/scan/fingerprint.ts");

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const fps = [];
let atlasBytes = 0;
const atlases = Math.ceil(cards.length / PER_ATLAS);
for (let a = 0; a < atlases; a++) {
  const ids = cards.slice(a * PER_ATLAS, (a + 1) * PER_ATLAS).map((c) => c.id);
  const part = await page.evaluate(
    async ({ ids, ATLAS_COLS, ATLAS_ROWS }) => {
      const { FP_LEN } = await import("/src/scan/fingerprint.ts");
      const { REF_W, REF_H } = await import("/src/scan/verify.ts");
      const { describeCard } = await import("/src/scan/match.ts");
      const decode = new OffscreenCanvas(1, 1);
      const dctx = decode.getContext("2d", { willReadFrequently: true });
      const atlas = new OffscreenCanvas(ATLAS_COLS * REF_W, ATLAS_ROWS * REF_H);
      const actx = atlas.getContext("2d");
      actx.fillRect(0, 0, atlas.width, atlas.height);
      const fps = new Int8Array(ids.length * FP_LEN);
      const bad = [];
      for (let i = 0; i < ids.length; i++) {
        try {
          const img = await createImageBitmap(await (await fetch(`/scan-img/${encodeURIComponent(ids[i])}`)).blob());
          decode.width = img.width;
          decode.height = img.height;
          dctx.drawImage(img, 0, 0);
          const { fp, ref } = describeCard({ rgba: dctx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height });
          img.close();
          fps.set(fp, i * FP_LEN);
          const tile = new ImageData(REF_W, REF_H);
          for (let k = 0; k < ref.length; k++) {
            tile.data[k * 4] = tile.data[k * 4 + 1] = tile.data[k * 4 + 2] = ref[k];
            tile.data[k * 4 + 3] = 255;
          }
          actx.putImageData(tile, (i % ATLAS_COLS) * REF_W, Math.floor(i / ATLAS_COLS) * REF_H);
        } catch (err) {
          bad.push(ids[i]);
        }
      }
      const b64 = async (bytes) => {
        const url = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(new Blob([bytes]));
        });
        return url.slice(url.indexOf(",") + 1);
      };
      const webp = await atlas.convertToBlob({ type: "image/webp", quality: 0.85 });
      return { fps: await b64(fps), atlas: await b64(await webp.arrayBuffer()), bad };
    },
    { ids, ATLAS_COLS, ATLAS_ROWS },
  );
  if (part.bad.length) throw new Error(`obrázky nejdou dekódovat (smaž je z .scan-cache/img a spusť znovu): ${part.bad.join(", ")}`);
  fps.push(Buffer.from(part.fps, "base64"));
  const atlas = Buffer.from(part.atlas, "base64");
  atlasBytes += atlas.length;
  await writeFile(join(OUT, `refs-${a}.webp`), atlas);
  console.log(`  arch ${a + 1}/${atlases} (${(atlas.length / 1024).toFixed(0)} kB)`);
}
await browser.close();
await server.close();

const fpsAll = Buffer.concat(fps);
await writeFile(join(OUT, "fps.bin"), fpsAll);
const index = {
  version: 1,
  built: new Date().toISOString().slice(0, 10),
  count: cards.length,
  atlasCols: ATLAS_COLS,
  atlasRows: ATLAS_ROWS,
  atlases,
  // karta = [číslo v sadě, jméno]; id karty v TCGdex je „<id sady>-<číslo>“
  sets: sets.filter((s) => s.cards.length).map((s) => ({ id: s.id, name: s.name, serie: s.serie, year: s.year, base: s.base, cards: s.cards.map((c) => [c.localId, c.name]) })),
};
const mismatch = sets.flatMap((s) => s.cards.filter((c) => c.id !== `${s.id}-${c.localId}`).map((c) => c.id));
if (mismatch.length) throw new Error(`id karty neodpovídá vzoru sada-číslo: ${mismatch.slice(0, 5).join(", ")}`);
const json = JSON.stringify(index);
await writeFile(join(OUT, "index.json"), json);
const mb = (n) => (n / 1024 / 1024).toFixed(1) + " MB";
console.log(`hotovo: ${cards.length} karet, index ${mb(json.length)}, otisky ${mb(fpsAll.length)}, náhledy ${mb(atlasBytes)}`);
