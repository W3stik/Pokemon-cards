// Stáhne sady a jejich karty z otevřeného repozitáře PokemonTCG/pokemon-tcg-data
// (stejná data, jaká vrací api.pokemontcg.io) a uloží je zmenšené do public/data.
// Bere všechny booster sady vybraných ér (SERIES) a jednotlivé starší sady
// (EXTRA_SETS). Spouští se ručně: npm run data
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAW = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
// Éry, ze kterých se berou všechny booster sady, a vybrané sady starších ér.
const SERIES = ["Mega Evolution", "Scarlet & Violet"];
const EXTRA_SETS = ["swsh7"]; // Evolving Skies

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// Promo sady a podobné produkty se v booster balíčcích neprodávají.
const isBoosterSet = (s) => !/promo|energies|trainer kit|mcdonald/i.test(s.name);

// Podsady, které se prodávají v balíčcích jiné sady (podsada → hlavní sada).
const SUBSETS = { me55c: { parent: "me55", label: "Classic Collection", prefix: "CC" } };

const allSets = await getJson(`${RAW}/sets/en.json`);
const sets = allSets
  .filter((s) => isBoosterSet(s) && !SUBSETS[s.id] && (SERIES.includes(s.series) || EXTRA_SETS.includes(s.id)))
  .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));

await mkdir(OUT, { recursive: true });

// Náhledy z images.pokemontcg.io jsou PNG kolem 160 kB, stejné obrázky na Scrydexu
// (CDN, na kterou projekt přechází) mají stejné rozlišení a třetinovou velikost.
const smallImage = (c) =>
  /^https:\/\/images\.pokemontcg\.io\/[^/]+\/\d+\.png$/.test(c.images.small)
    ? `https://images.scrydex.com/pokemon/${c.id}/small`
    : c.images.small;

// Číslo karty bereme z jejího id (sada-číslo): ve zdroji je občas chybně, např. Black Bolt
// zsv10pt5-80 (Antique Cover Fossil) má number 60 jako Escavalier.
function cardNumber(c) {
  const fromId = c.id.slice(c.id.lastIndexOf("-") + 1);
  if (/^\d+$/.test(fromId) && Number(fromId) !== Number(c.number)) {
    console.warn(`  ${c.id}: číslo ${c.number} nesedí s id, použito ${fromId}`);
    return Number(fromId);
  }
  return Number(c.number);
}

// Chybné rarity ve zdroji (ověřeno proti TCGdex a Bulbapedii): Victini z Black Bolt a White
// Flare je Black White Rare (ve zdroji „Rare“, takže by padal jako obyčejná karta), Archen
// č. 131 z White Flare je Illustration Rare (ve zdroji „Uncommon“).
const RARITY_FIXES = {
  "zsv10pt5-171": "Black White Rare",
  "rsv10pt5-172": "Black White Rare",
  "rsv10pt5-131": "Illustration Rare",
};

const rarityOf = (c) => RARITY_FIXES[c.id] ?? (c.rarity === "MEGA_ATTACK_RARE" ? "Mega Attack Rare" : c.rarity);

// Éra Sword & Shield: alternativní ilustrace (alt arty) mají ve zdroji stejnou raritu
// jako běžný full art / rainbow, ale jsou mnohem vzácnější. Jsou to vždy druhé ze dvou
// po sobě jdoucích karet téhož Pokémona (Evolving Skies: Umbreon V 188 a alt art 189).
const ALT_ART = { "Rare Ultra": "Alternate Art", "Rare Rainbow": "Alternate Art VMAX" };
function markAltArts(cards) {
  for (let i = 1; i < cards.length; i++) {
    const [prev, card] = [cards[i - 1], cards[i]];
    if (ALT_ART[card.rarity] && card.supertype === "Pokémon" && prev.name === card.name && prev.rarity === card.rarity) {
      card.rarity = ALT_ART[card.rarity];
    }
  }
}

const slimCard = (c) => ({
  id: c.id,
  name: c.name,
  number: cardNumber(c),
  rarity: rarityOf(c),
  supertype: c.supertype,
  subtypes: c.subtypes ?? [],
  types: c.types ?? [],
  hp: c.hp ?? null,
  artist: c.artist ?? null,
  img: smallImage(c),
  imgLarge: c.images.large,
});

const index = [];
for (const set of sets) {
  const cards = await getJson(`${RAW}/cards/en/${set.id}.json`);
  const slim = cards
    // Karty s nečíselným číslem (např. R/G/B varianty) se v balíčcích nevyskytují.
    .filter((c) => /^\d+$/.test(c.number) && c.rarity)
    .map(slimCard)
    .sort((a, b) => a.number - b.number);
  if (set.series === "Sword & Shield") markAltArts(slim);

  // Reprinty z podsady mají původní čísla ze starých sad, proto je přečíslujeme
  // podle pořadí (CC1–CC30) a původní raritu si necháme jen pro zobrazení.
  for (const [subId, sub] of Object.entries(SUBSETS)) {
    if (sub.parent !== set.id) continue;
    const subCards = await getJson(`${RAW}/cards/en/${subId}.json`);
    subCards.forEach((c, i) =>
      slim.push({
        ...slimCard(c),
        number: i + 1,
        prefix: sub.prefix,
        rarity: sub.label,
        printedRarity: c.rarity ?? null,
      }),
    );
  }

  await writeFile(join(OUT, `${set.id}.json`), JSON.stringify(slim));
  index.push({
    id: set.id,
    name: set.name,
    series: set.series,
    code: set.ptcgoCode ?? null,
    releaseDate: set.releaseDate.replaceAll("/", "-"),
    printedTotal: set.printedTotal,
    total: slim.length,
    logo: set.images.logo,
    symbol: set.images.symbol,
  });
  console.log(`${set.id.padEnd(10)} ${set.name.padEnd(22)} ${slim.length} karet`);
}

await writeFile(join(OUT, "sets.json"), JSON.stringify(index, null, 1));
console.log(`Hotovo: ${index.length} sad v ${OUT}`);

// Menší obrázky (WebP z TCGdex), kde jsou k dispozici.
await import("./fetch-images.mjs");
