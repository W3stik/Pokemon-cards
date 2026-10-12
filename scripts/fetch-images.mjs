// Přepne obrázky karet v public/data na WebP z TCGdex: náhled (low, 245×337) má ~17 kB
// místo ~50 kB PNG ze Scrydexu, velký (high, 600×825) ~70 kB místo ~550 kB.
// Každý soubor se před použitím ověří; kde TCGdex obrázek nemá, zůstane původní.
// Spouští se po `npm run data` (je jeho součástí), samostatně: npm run images
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { API, getJson, HEADERS, pairSet, pool } from "./tcgdex.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");

async function exists(url) {
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, { method: "HEAD", headers: HEADERS, signal: AbortSignal.timeout(20000) });
      return res.ok && (res.headers.get("content-type") ?? "").startsWith("image/");
    } catch {
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
  return false;
}

const sets = JSON.parse(await readFile(join(DATA, "sets.json"), "utf8"));
const tcgdexSets = await getJson(`${API}/sets`);

for (const set of sets) {
  const file = join(DATA, `${set.id}.json`);
  const raw = await readFile(file, "utf8");
  const cards = JSON.parse(raw);
  const paired = await pairSet(set, cards, tcgdexSets);
  if (!paired) continue;

  const byId = new Map(cards.map((c) => [c.id, c]));
  const checked = await pool(
    paired.pairs.filter(([, remote]) => remote.image),
    async ([id, remote]) => {
      const low = `${remote.image}/low.webp`;
      const high = `${remote.image}/high.webp`;
      const [hasLow, hasHigh] = await Promise.all([exists(low), exists(high)]);
      return { id, low: hasLow ? low : null, high: hasHigh ? high : null };
    },
    16,
  );

  let small = 0;
  let large = 0;
  for (const r of checked) {
    const card = r && !r.error ? byId.get(r.id) : null;
    if (!card) continue;
    if (r.low) {
      card.img = r.low;
      small++;
    }
    if (r.high) {
      card.imgLarge = r.high;
      large++;
    }
  }
  await writeFile(file, JSON.stringify(cards) + (raw.endsWith("\n") ? "\n" : ""));
  console.log(`${set.id.padEnd(10)} náhledy ${small}/${cards.length}, velké ${large}/${cards.length}`);
}
