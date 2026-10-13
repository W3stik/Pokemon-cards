// Složení balíčků a šance na tah jednotlivých rarit.
//
// The Pokémon Company šance oficiálně nezveřejňuje. Čísla níže pocházejí
// z měření TCGplayer Authentication Center (tisíce otevřených balíčků) a tam,
// kde chybí, z komunitních sčítání. Každá sada má u sebe uvedené zdroje.
import type { Variant } from "./types";

export interface RarityInfo {
  /** Pořadí od nejběžnější po nejvzácnější. */
  rank: number;
  /** Zkratka zobrazovaná na kartě v albu. */
  short: string;
  /** Barva rarity v rozhraní. */
  color: string;
  /** Typ lesku při zobrazení karty. */
  shine: "none" | "holo" | "ex" | "cosmos" | "illus" | "etched" | "sir" | "gold" | "neon" | "dark";
  /** Zda jde o „hit“, který si zaslouží zvláštní animaci při odhalení. */
  hit: boolean;
}

export const RARITIES: Record<string, RarityInfo> = {
  Common: { rank: 0, short: "C", color: "#9aa3ad", shine: "none", hit: false },
  Uncommon: { rank: 1, short: "U", color: "#5fb3a1", shine: "none", hit: false },
  Rare: { rank: 2, short: "R", color: "#e6c84f", shine: "holo", hit: false },
  "Pikachu Rare": { rank: 3, short: "PR", color: "#ffd84a", shine: "holo", hit: false },
  "Double Rare": { rank: 4, short: "RR", color: "#f0a33a", shine: "ex", hit: true },
  "Classic Collection": { rank: 5, short: "CC", color: "#c48af0", shine: "cosmos", hit: true },
  "Illustration Rare": { rank: 6, short: "IR", color: "#55c1f2", shine: "illus", hit: true },
  "Ultra Rare": { rank: 7, short: "UR", color: "#c9d4e0", shine: "etched", hit: true },
  "Mega Attack Rare": { rank: 7, short: "MAR", color: "#ff6fa8", shine: "etched", hit: true },
  "Special Illustration Rare": { rank: 8, short: "SIR", color: "#ff7ad9", shine: "sir", hit: true },
  "Hyper Rare": { rank: 9, short: "HR", color: "#ffcf3f", shine: "gold", hit: true },
  "Mega Hyper Rare": { rank: 9, short: "MHR", color: "#ffcf3f", shine: "gold", hit: true },
  "Futuristic Rare": { rank: 9, short: "FR", color: "#7df9ff", shine: "neon", hit: true },
  "Black White Rare": { rank: 10, short: "BWR", color: "#f4f4f4", shine: "dark", hit: true },
  // Scarlet & Violet
  "ACE SPEC Rare": { rank: 5, short: "ACE", color: "#ff5fb2", shine: "etched", hit: true },
  "Shiny Rare": { rank: 3, short: "SR", color: "#b8a6ff", shine: "illus", hit: false },
  "Shiny Ultra Rare": { rank: 7, short: "SUR", color: "#d9b8ff", shine: "etched", hit: true },
  // Sword & Shield (Evolving Skies)
  "Rare Holo": { rank: 2, short: "RH", color: "#e6c84f", shine: "holo", hit: false },
  "Rare Holo V": { rank: 4, short: "V", color: "#7fb2ff", shine: "ex", hit: true },
  "Rare Holo VMAX": { rank: 5, short: "VMAX", color: "#ff7a7a", shine: "ex", hit: true },
  "Rare Ultra": { rank: 6, short: "FA", color: "#c9d4e0", shine: "etched", hit: true },
  "Alternate Art": { rank: 7, short: "AA", color: "#5fe0c0", shine: "illus", hit: true },
  "Rare Rainbow": { rank: 8, short: "RR+", color: "#ff9ef0", shine: "sir", hit: true },
  "Alternate Art VMAX": { rank: 9, short: "AA+", color: "#3ff0d0", shine: "sir", hit: true },
  "Rare Secret": { rank: 9, short: "SEC", color: "#ffcf3f", shine: "gold", hit: true },
};

export const rarityInfo = (rarity: string): RarityInfo =>
  RARITIES[rarity] ?? { rank: 2, short: "?", color: "#888", shine: "holo", hit: false };

export const VARIANT_LABEL: Record<Variant, string> = {
  normal: "Normální",
  reverse: "Reverse holo",
  pokeball: "Poké Ball holo",
  masterball: "Master Ball holo",
};

/** Výsledek, který může padnout ve slotu: rarita (nebo skupina rarit) a provedení. */
export interface Outcome {
  rarities: string[];
  variant: Variant;
  /** Pravděpodobnost na balíček (0–1). U výchozího výsledku se neuvádí. */
  p?: number;
}

export interface Slot {
  label: string;
  /** Kolik karet z tohoto slotu v balíčku je. */
  count: number;
  /** Vzácné výsledky, losují se postupně podle pravděpodobnosti. */
  hits: Outcome[];
  /** Co padne, když nepadne žádný vzácný výsledek. */
  base: Outcome;
}

export interface Source {
  label: string;
  url: string;
}

/** Vzácný balíček, ve kterém je každá karta „hit“ (místo běžného složení). */
export interface GodPack {
  /** Pravděpodobnost na balíček (0–1). */
  p: number;
  slots: Slot[];
}

export interface PackProfile {
  /** Barvy obalu balíčku. */
  colors: [string, string];
  slots: Slot[];
  godPack?: GodPack;
  note?: string;
  sources: Source[];
}

const REVERSE_POOL = ["Common", "Uncommon", "Rare"];

const commons = (count: number): Slot => ({
  label: "Common",
  count,
  hits: [],
  base: { rarities: ["Common"], variant: "normal" },
});

const uncommons = (count: number): Slot => ({
  label: "Uncommon",
  count,
  hits: [],
  base: { rarities: ["Uncommon"], variant: "normal" },
});

/** Slot s pevnou raritou (bez losování vzácnějších výsledků), např. v god packu. */
const fixedSlot = (label: string, count: number, rarities: string[]): Slot => ({
  label,
  count,
  hits: [],
  base: { rarities, variant: "normal" },
});

const reverse = (label = "Reverse holo"): Slot => ({
  label,
  count: 1,
  hits: [],
  base: { rarities: REVERSE_POOL, variant: "reverse" },
});

interface StandardRates {
  doubleRare: number;
  ultraRare: number;
  illustrationRare: number;
  specialIllustrationRare: number;
  /** Zlatá karta: Hyper Rare (Scarlet & Violet) nebo Mega Hyper Rare (Mega Evolution). */
  gold: number;
  goldRarity: "Hyper Rare" | "Mega Hyper Rare";
  megaAttackRare?: number;
  /** ACE SPEC Rare (od Temporal Forces) místo prvního reverse holo. */
  aceSpec?: number;
}

/**
 * Standardní balíček éry Scarlet & Violet a Mega Evolution:
 * 4 Common, 3 Uncommon, 2 reverse holo (druhý z nich může být IR/SIR/zlatá)
 * a 1 Rare slot (Rare, Double Rare, Ultra Rare…). Plus Basic Energy a kód,
 * které se nesbírají.
 */
const standardSlots = (r: StandardRates): Slot[] => [
  commons(4),
  uncommons(3),
  r.aceSpec
    ? {
        label: "Reverse holo / ACE SPEC",
        count: 1,
        hits: [{ rarities: ["ACE SPEC Rare"], variant: "normal", p: r.aceSpec }],
        base: { rarities: REVERSE_POOL, variant: "reverse" },
      }
    : reverse(),
  {
    label: "Reverse holo / Illustration",
    count: 1,
    hits: [
      { rarities: [r.goldRarity], variant: "normal", p: r.gold },
      { rarities: ["Special Illustration Rare"], variant: "normal", p: r.specialIllustrationRare },
      { rarities: ["Illustration Rare"], variant: "normal", p: r.illustrationRare },
    ],
    base: { rarities: REVERSE_POOL, variant: "reverse" },
  },
  {
    label: "Rare",
    count: 1,
    hits: [
      ...(r.megaAttackRare
        ? [{ rarities: ["Mega Attack Rare"], variant: "normal" as const, p: r.megaAttackRare }]
        : []),
      { rarities: ["Ultra Rare"], variant: "normal", p: r.ultraRare },
      { rarities: ["Double Rare"], variant: "normal", p: r.doubleRare },
    ],
    base: { rarities: ["Rare"], variant: "normal" },
  },
];

const TCGPLAYER = "https://www.tcgplayer.com/content/article/";

/** Mega Evolution sady s „klasickými“ šancemi naměřenými TCGplayer (ME1, PFL, POR, CRI, PBL). */
const megaEvolutionRates = (overrides: Partial<StandardRates> = {}): StandardRates => ({
  doubleRare: 0.2077,
  ultraRare: 0.0806,
  illustrationRare: 0.1097,
  specialIllustrationRare: 0.0125,
  gold: 0.0008,
  goldRarity: "Mega Hyper Rare",
  ...overrides,
});

/** Standardní sada Scarlet & Violet (zlatá karta = Hyper Rare). */
const svRates = (r: Omit<StandardRates, "goldRarity">): StandardRates => ({ ...r, goldRarity: "Hyper Rare" });
const tcgtalk = (slug: string, name: string): Source => ({
  label: `TCGTalk – ${name} pull rates (komunitní data z hromadných otevírání)`,
  url: `https://tcgtalk.com/guides/${slug}-pack-opening-value-guide`,
});

const blackWhite = (colors: [string, string]): PackProfile => ({
  colors,
  slots: [
    commons(4),
    uncommons(3),
    {
      label: "Reverse / Poké Ball",
      count: 1,
      hits: [{ rarities: REVERSE_POOL, variant: "pokeball", p: 1 / 3 }],
      base: { rarities: REVERSE_POOL, variant: "reverse" },
    },
    {
      label: "Reverse / Master Ball / Illustration",
      count: 1,
      hits: [
        // dvě karty (Victini + Zekrom ex / Reshiram ex), každá zhruba 1:1800
        { rarities: ["Black White Rare"], variant: "normal", p: 2 / 1789 },
        { rarities: ["Special Illustration Rare"], variant: "normal", p: 1 / 80 },
        { rarities: ["Illustration Rare"], variant: "normal", p: 0.1639 },
        { rarities: REVERSE_POOL, variant: "masterball", p: 1 / 19 },
      ],
      base: { rarities: REVERSE_POOL, variant: "reverse" },
    },
    {
      label: "Rare",
      count: 1,
      hits: [
        { rarities: ["Ultra Rare"], variant: "normal", p: 1 / 17 },
        { rarities: ["Double Rare"], variant: "normal", p: 0.2111 },
      ],
      base: { rarities: ["Rare"], variant: "normal" },
    },
  ],
  note:
    "Black White Rare jsou v sadě dvě (Victini a Zekrom ex / Reshiram ex). Ve vzorku TCGplayer (700+ balíčků) nepadla ani jednou; šance zhruba 1:1800 na každou z nich je komunitní odhad (Pack Magik uvádí u Victini 1:1000). Poké Ball vzor ~1:3, Master Ball vzor ~1:19.",
  sources: [
    { label: "Deltia's Gaming – Black Bolt / White Flare Pull Rates (data TCGplayer)", url: "https://deltiasgaming.com/?p=299238" },
    { label: "CardCodex – Black Bolt / White Flare pull rates", url: "https://cardcodex.com/blog/black-bolt-white-flare-pull-rates/" },
    { label: "TCGTalk – Black Bolt value guide", url: "https://tcgtalk.com/guides/black-bolt-pack-opening-value-guide" },
    { label: "Bulbapedia – Victini (Black Bolt 171), Black White Rare", url: "https://bulbapedia.bulbagarden.net/wiki/Victini_(Black_Bolt_171)" },
  ],
});

export const PACKS: Record<string, PackProfile> = {
  sv10: {
    colors: ["#1b1b2f", "#b3122e"],
    slots: standardSlots({
      doubleRare: 0.2,
      ultraRare: 1 / 16,
      illustrationRare: 1 / 12,
      specialIllustrationRare: 1 / 94,
      gold: 1 / 149,
      goldRarity: "Hyper Rare",
    }),
    note: "Zdroje se u Destined Rivals rozcházejí (SIR 1:83–1:100). Použity hodnoty z 8 000+ balíčků TCGplayer, jak je cituje Deltia's Gaming.",
    sources: [
      { label: "Deltia's Gaming – Destined Rivals Pull Rates (data TCGplayer)", url: "https://deltiasgaming.com/?p=249103" },
      { label: "TCGTalk – Destined Rivals value guide", url: "https://tcgtalk.com/guides/destined-rivals-pack-opening-value-guide" },
      { label: "TCG Watchtower – Destined Rivals", url: "https://tcgwatchtower.com/pokemon/sets/scarlet-violet/destined-rivals/cards" },
    ],
  },
  zsv10pt5: blackWhite(["#0d0d0d", "#3a3f4a"]),
  rsv10pt5: blackWhite(["#f4f1ea", "#c9a86a"]),
  me1: {
    colors: ["#1f3c88", "#6fd3ff"],
    slots: standardSlots(
      megaEvolutionRates({ doubleRare: 0.2, ultraRare: 1 / 12, illustrationRare: 0.1089, specialIllustrationRare: 0.0099, gold: 1 / 1260 }),
    ),
    sources: [
      { label: "TCGplayer – Mega Evolution Pull Rates", url: `${TCGPLAYER}Pok%C3%A9mon-TCG-Mega-Evolution-Pull-Rates/40cbeedc-21ce-473b-aef1-74e3969d9f91/` },
      { label: "Screen Rant – Mega Hyper Rare odds", url: "https://screenrant.com/pokemon-mega-evolution-cards-pull-rates-rarest-ever/" },
    ],
  },
  me2: {
    colors: ["#2a0b0b", "#ff5a1f"],
    slots: standardSlots(megaEvolutionRates()),
    sources: [
      { label: "TCGplayer – Phantasmal Flames Pull Rates", url: `${TCGPLAYER}Pok%C3%A9mon-TCG-Phantasmal-Flames-Pull-Rates/9abae60d-b7fb-448f-874e-176f78d6a6ca/` },
    ],
  },
  me2pt5: {
    colors: ["#2b1650", "#f2c14e"],
    slots: standardSlots({
      doubleRare: 0.2,
      ultraRare: 1 / 21,
      megaAttackRare: 1 / 29,
      illustrationRare: 1 / 9,
      specialIllustrationRare: 1 / 70,
      gold: 1 / 540,
      goldRarity: "Mega Hyper Rare",
    }),
    // God pack: oficiálně nepotvrzený, sběratelé ho natočili; komunitní odhad je 1:1500–1:4000,
    // ve hře je schválně častější (1:500). Přesné složení nikde uvedené není, toto je návrh:
    // 4× IR, 3× full art (Ultra / Mega Attack Rare), 2× SIR a na konci SIR, nebo 1:10 Mega Hyper Rare.
    godPack: {
      p: 1 / 500,
      slots: [
        fixedSlot("Illustration Rare", 4, ["Illustration Rare"]),
        fixedSlot("Ultra Rare / Mega Attack Rare", 3, ["Ultra Rare", "Mega Attack Rare"]),
        fixedSlot("Special Illustration Rare", 2, ["Special Illustration Rare"]),
        {
          label: "Special Illustration Rare / Mega Hyper Rare",
          count: 1,
          hits: [{ rarities: ["Mega Hyper Rare"], variant: "normal", p: 1 / 10 }],
          base: { rarities: ["Special Illustration Rare"], variant: "normal" },
        },
      ],
    },
    note:
      "Mega Attack Rare zabírají místo Ultra Rare, proto jsou Ultra Rare vzácnější (1:21). God pack (10 karet, všechny vzácné: 4× IR, 3× full art, 2–3× SIR, případně Mega Hyper Rare) oficiálně potvrzený není; sběratelé ho odhadují na 1:1500–1:4000, ve hře padá častěji (1:500) a jeho složení je odhad.",
    sources: [
      { label: "TCGplayer – Ascended Heroes Pull Rates", url: `${TCGPLAYER}Pok%C3%A9mon-TCG-Ascended-Heroes-Pull-Rates/60143d94-88a7-42ce-8e73-babd7b3fabd6/` },
      { label: "PokeBeach – Ascended Heroes pull rates", url: "https://www.pokebeach.com/2026/02/ascended-heroes-pull-rates-finally-determined-better-than-usual" },
      { label: "CardCodex – Ascended Heroes pull rates", url: "https://cardcodex.com/blog/ascended-heroes-pull-rates-explained/" },
      { label: "TCGTalk – Ascended Heroes pull rates & god pack", url: "https://tcgtalk.com/guides/ascended-heroes-pull-rates-god-pack" },
    ],
  },
  me3: {
    colors: ["#0f3b2e", "#7ee0b5"],
    slots: standardSlots(megaEvolutionRates({ ultraRare: 1 / 12, illustrationRare: 1 / 9, gold: 1 / 1786 })),
    note: "TCGplayer měl u Perfect Order menší vzorek; šance odpovídají předchozím sadám Mega Evolution.",
    sources: [
      { label: "TCGplayer – Perfect Order Pull Rates", url: `${TCGPLAYER}Pok%C3%A9mon-TCG-Perfect-Order-Pull-Rates/73148119-ebcb-40b7-84b6-52b3a6d0c631/` },
    ],
  },
  me4: {
    colors: ["#06263d", "#3fb6e8"],
    slots: standardSlots(megaEvolutionRates({ doubleRare: 0.2, illustrationRare: 0.11, specialIllustrationRare: 1 / 83, gold: 1 / 1000 })),
    note: "U Chaos Rising zatím není článek TCGplayer. Double Rare a IR podle vzorku 5 000+ balíčků (Cardlines), SIR a MHR jsou komunitní odhady.",
    sources: [
      { label: "Cardlines – Chaos Rising pull rates", url: "https://cardlines.com/chaos-rising-one-after-release-pull-rates-prices-and-what-to-buy/" },
      { label: "TCGTalk – Chaos Rising pull rates", url: "https://tcgtalk.com/guides/chaos-rising-pull-rates" },
      { label: "ComicBook – Chaos Rising estimates", url: "https://comicbook.com/gaming/feature/pokemon-tcg-chaos-rising-pull-rates-ex-illustration-rares-estimates/" },
    ],
  },
  me5: {
    colors: ["#09070f", "#6b3fa0"],
    slots: standardSlots(megaEvolutionRates({ doubleRare: 0.2102, ultraRare: 0.083, illustrationRare: 0.1101, gold: 0.0009 })),
    sources: [
      { label: "TCGplayer – Pitch Black Pull Rates", url: `${TCGPLAYER}Pok%C3%A9mon-TCG-Pitch-Black-Pull-Rates/069a5fda-2d1f-44a1-97de-b6dcdc5abfb8/` },
    ],
  },
  me55: {
    colors: ["#c8102e", "#ffd400"],
    slots: [
      {
        label: "Common (foil)",
        count: 2,
        hits: [],
        base: { rarities: ["Common"], variant: "normal" },
      },
      {
        label: "Rare",
        count: 1,
        hits: [
          { rarities: ["Classic Collection"], variant: "normal", p: 1 / 10.5 },
          { rarities: ["Double Rare"], variant: "normal", p: 1 / 4.4 },
        ],
        base: { rarities: ["Rare"], variant: "normal" },
      },
      {
        label: "Illustration",
        count: 1,
        hits: [
          { rarities: ["Futuristic Rare"], variant: "normal", p: 1 / 120 },
          { rarities: ["Special Illustration Rare"], variant: "normal", p: 1 / 19.8 },
          { rarities: ["Illustration Rare"], variant: "normal", p: 1 / 5.6 },
        ],
        base: { rarities: ["Common"], variant: "normal" },
      },
      {
        label: "Pikachu Rare",
        count: 1,
        hits: [],
        base: { rarities: ["Pikachu Rare"], variant: "normal" },
      },
    ],
    note: "Speciální sada: 5 foil karet, poslední je vždy jeden z 30 Pikachu Rare. Futuristic Rare podle 3 000 balíčků TCGplayer, ostatní rarity podle ~800 komunitně zapsaných balíčků.",
    sources: [
      { label: "TCGplayer – 30th Celebration Pull Rates", url: `${TCGPLAYER}Pok%C3%A9mon-TCG-30th-Celebration-Pull-Rates/587b3657-481a-4ab8-827c-68cd3ab585b0/` },
      { label: "cardprice.com – 30th Celebration measured odds", url: "https://cardprice.com/guides/30th-celebration-pull-rates" },
      { label: "Treasure Vault – 30th Celebration early data", url: "https://treasurevaultau.com/blogs/news/pokemon-tcg-30th-celebration-pull-rates" },
    ],
  },

  // --- Scarlet & Violet ----------------------------------------------------
  sv9: {
    colors: ["#1b2a4a", "#f2a33a"],
    slots: standardSlots(svRates({ doubleRare: 0.2, ultraRare: 1 / 15, illustrationRare: 1 / 12, specialIllustrationRare: 1 / 86, gold: 1 / 137 })),
    sources: [tcgtalk("journey-together", "Journey Together")],
  },
  sv8pt5: {
    colors: ["#2a1648", "#f5a3d6"],
    slots: [
      commons(4),
      uncommons(3),
      {
        label: "Reverse / Poké Ball / ACE SPEC",
        count: 1,
        hits: [
          { rarities: ["ACE SPEC Rare"], variant: "normal", p: 1 / 21 },
          { rarities: REVERSE_POOL, variant: "pokeball", p: 1 / 3 },
        ],
        base: { rarities: REVERSE_POOL, variant: "reverse" },
      },
      {
        label: "Reverse / Master Ball / SIR",
        count: 1,
        hits: [
          { rarities: ["Hyper Rare"], variant: "normal", p: 1 / 180 },
          { rarities: ["Special Illustration Rare"], variant: "normal", p: 1 / 45 },
          { rarities: REVERSE_POOL, variant: "masterball", p: 1 / 20 },
        ],
        base: { rarities: REVERSE_POOL, variant: "reverse" },
      },
      {
        label: "Rare",
        count: 1,
        hits: [
          { rarities: ["Ultra Rare"], variant: "normal", p: 1 / 13 },
          { rarities: ["Double Rare"], variant: "normal", p: 0.18 },
        ],
        base: { rarities: ["Rare"], variant: "normal" },
      },
    ],
    note: "Speciální sada bez Illustration Rare: reverse holo mají vzor Poké Ball (~1:3) nebo Master Ball (~1:20). SIR (32 karet, mezi nimi Eeveelutions) 1:45, Hyper Rare 1:180 – komunitní data, zdroje se rozcházejí (SIR 1:45–1:53).",
    sources: [
      tcgtalk("prismatic-evolutions", "Prismatic Evolutions"),
      { label: "cardtracker.au – pull rates by set (TCGplayer přes PokeBeach, 1 200 balíčků)", url: "https://cardtracker.au/insights/guides/pokemon-card-pull-rates" },
    ],
  },
  sv8: {
    colors: ["#2a1f05", "#ffd23f"],
    slots: standardSlots(svRates({ doubleRare: 0.2, ultraRare: 1 / 15, illustrationRare: 1 / 13, specialIllustrationRare: 1 / 87, gold: 1 / 188, aceSpec: 1 / 20 })),
    note: "Double Rare zdroj zvlášť neuvádí, použita hodnota okolních sad (1:5).",
    sources: [tcgtalk("surging-sparks", "Surging Sparks")],
  },
  sv7: {
    colors: ["#14213d", "#7cc6fe"],
    slots: standardSlots(svRates({ doubleRare: 0.2, ultraRare: 1 / 15, illustrationRare: 1 / 13, specialIllustrationRare: 1 / 90, gold: 1 / 137, aceSpec: 1 / 20 })),
    sources: [tcgtalk("stellar-crown", "Stellar Crown")],
  },
  sv6pt5: {
    colors: ["#160d24", "#6d4aa8"],
    slots: standardSlots(svRates({ doubleRare: 0.2, ultraRare: 1 / 15, illustrationRare: 1 / 12, specialIllustrationRare: 1 / 67, gold: 1 / 144, aceSpec: 1 / 20 })),
    note: "Menší speciální sada; šance podle ~1 500 komunitně zapsaných balíčků (SIR se mezi zdroji liší, 1:50–1:67).",
    sources: [tcgtalk("shrouded-fable", "Shrouded Fable")],
  },
  sv6: {
    colors: ["#0f2a1e", "#2fbf71"],
    slots: standardSlots(svRates({ doubleRare: 0.2, ultraRare: 1 / 15, illustrationRare: 1 / 13, specialIllustrationRare: 1 / 86, gold: 1 / 146, aceSpec: 1 / 20 })),
    sources: [tcgtalk("twilight-masquerade", "Twilight Masquerade")],
  },
  sv5: {
    colors: ["#1d1a3a", "#38bdf8"],
    slots: standardSlots(svRates({ doubleRare: 0.21, ultraRare: 1 / 15, illustrationRare: 1 / 13, specialIllustrationRare: 1 / 86, gold: 1 / 139, aceSpec: 1 / 20 })),
    note: "První sada s ACE SPEC Rare (1:20), které nahrazují první reverse holo.",
    sources: [
      tcgtalk("temporal-forces", "Temporal Forces"),
      { label: "Temporal Forces pull rates (data TCGplayer)", url: "https://www.josephwriteranderson.com/blog/temporal-forces-pull-rates" },
    ],
  },
  sv4pt5: {
    colors: ["#1a1030", "#ff9ad5"],
    slots: [
      commons(4),
      uncommons(3),
      { label: "Shiny Rare", count: 1, hits: [], base: { rarities: ["Shiny Rare"], variant: "normal" } },
      {
        label: "Reverse holo / Shiny Ultra Rare / Illustration",
        count: 1,
        hits: [
          { rarities: ["Hyper Rare"], variant: "normal", p: 1 / 62 },
          { rarities: ["Special Illustration Rare"], variant: "normal", p: 1 / 58 },
          { rarities: ["Illustration Rare"], variant: "normal", p: 1 / 14 },
          { rarities: ["Shiny Ultra Rare"], variant: "normal", p: 1 / 13 },
        ],
        base: { rarities: REVERSE_POOL, variant: "reverse" },
      },
      {
        label: "Rare",
        count: 1,
        hits: [
          { rarities: ["Ultra Rare"], variant: "normal", p: 1 / 15 },
          { rarities: ["Double Rare"], variant: "normal", p: 0.34 },
        ],
        base: { rarities: ["Rare"], variant: "normal" },
      },
    ],
    note: "Speciální sada: v každém balíčku je Shiny Rare (místo jednoho reverse holo) ze 120 karet, Shiny Ultra Rare 1:13. Komunitní data (~1 500 balíčků); podle jiných zdrojů je Shiny Rare jen v každém 4. balíčku.",
    sources: [
      tcgtalk("paldean-fates", "Paldean Fates"),
      { label: "PokeBeach – Paldean Fates pull rates (1 500 balíčků)", url: "https://www.pokebeach.com/?p=281473" },
    ],
  },
  sv4: {
    colors: ["#1a1424", "#8e44ad"],
    slots: standardSlots(svRates({ doubleRare: 1 / 6, ultraRare: 1 / 15, illustrationRare: 1 / 13, specialIllustrationRare: 1 / 47, gold: 1 / 82 })),
    sources: [tcgtalk("paradox-rift", "Paradox Rift")],
  },
  sv3pt5: {
    colors: ["#0c2340", "#e63946"],
    slots: standardSlots(svRates({ doubleRare: 0.1328, ultraRare: 1 / 16, illustrationRare: 0.085, specialIllustrationRare: 0.0311, gold: 0.0194 })),
    note: "Šance podle měření TCGplayer. Sada má i god packy, ty ve výpočtu nejsou.",
    sources: [
      { label: "TCGplayer – Scarlet & Violet—151 Pull Rates", url: `${TCGPLAYER}Pok%C3%A9mon-TCG-Scarlet-Violet%E2%80%94151-Pull-Rates/b237df74-fbb0-40d0-9e13-d69ee6e804d9/` },
    ],
  },
  sv3: {
    colors: ["#120a0a", "#ff6a00"],
    slots: standardSlots(svRates({ doubleRare: 1 / 7, ultraRare: 1 / 15, illustrationRare: 1 / 13, specialIllustrationRare: 1 / 32, gold: 1 / 52 })),
    sources: [tcgtalk("obsidian-flames", "Obsidian Flames")],
  },
  sv2: {
    colors: ["#10261f", "#5bd1a5"],
    slots: standardSlots(svRates({ doubleRare: 1 / 7, ultraRare: 1 / 15, illustrationRare: 1 / 13, specialIllustrationRare: 1 / 32, gold: 1 / 57 })),
    sources: [tcgtalk("paldea-evolved", "Paldea Evolved")],
  },
  sv1: {
    colors: ["#2b0f1f", "#c2185b"],
    slots: standardSlots(svRates({ doubleRare: 0.1354, ultraRare: 0.0648, illustrationRare: 0.0752, specialIllustrationRare: 0.0315, gold: 0.0185 })),
    note: "SIR a Hyper Rare podle měření TCGplayer (8 000+ balíčků), ostatní podle vzorku 1 728 balíčků (Card Shop Live).",
    sources: [
      { label: "TCGplayer – Scarlet & Violet Pull Rates", url: `${TCGPLAYER}Pok%C3%A9mon-TCG-Scarlet-Violet-Pull-Rates/a7702fce-dd64-4a58-beb1-0f871c853215/` },
      { label: "cardtracker.au – pull rates by set", url: "https://cardtracker.au/insights/guides/pokemon-card-pull-rates" },
    ],
  },

  // --- Sword & Shield --------------------------------------------------------
  swsh7: {
    colors: ["#0d2a4a", "#4fc3f7"],
    slots: [
      commons(5),
      uncommons(3),
      {
        label: "Reverse holo",
        count: 1,
        hits: [],
        base: { rarities: ["Common", "Uncommon", "Rare", "Rare Holo"], variant: "reverse" },
      },
      {
        label: "Rare",
        count: 1,
        hits: [
          { rarities: ["Rare Secret"], variant: "normal", p: 1 / 110 },
          { rarities: ["Alternate Art VMAX"], variant: "normal", p: 1 / 250 },
          { rarities: ["Rare Rainbow"], variant: "normal", p: 1 / 88 },
          { rarities: ["Alternate Art"], variant: "normal", p: 1 / 100 },
          { rarities: ["Rare Ultra"], variant: "normal", p: 1 / 26 },
          { rarities: ["Rare Holo VMAX"], variant: "normal", p: 1 / 18 },
          { rarities: ["Rare Holo V"], variant: "normal", p: 1 / 9.5 },
          { rarities: ["Rare Holo"], variant: "normal", p: 1 / 3 },
        ],
        base: { rarities: ["Rare"], variant: "normal" },
      },
    ],
    note: "Éra Sword & Shield: 5 Common, 3 Uncommon, reverse holo a jedna vzácnější karta. V, VMAX, full art, rainbow a zlaté podle Card Codex; alt arty (11 V, 6 VMAX vč. Umbreon VMAX) oficiální data nemají – odhad: alt art V 1:100 (DripShop uvádí 1,2 %), alt art VMAX 1:250, tedy konkrétní alt art VMAX zhruba 1:1500.",
    sources: [
      { label: "Card Codex – Evolving Skies pull rates", url: "https://cardcodex.com/pokemon/sword-shield/evolving-skies/evolving-skies-half-booster-box-swsh7/" },
      { label: "cardtracker.au – alt art V 1,2 % (DripShop)", url: "https://cardtracker.au/insights/guides/pokemon-card-pull-rates" },
    ],
  },
};

/** Výchozí profil pro sadu, pro kterou zatím nemáme naměřené šance. */
export const DEFAULT_PACK: PackProfile = {
  colors: ["#23324a", "#8aa4c8"],
  slots: standardSlots(megaEvolutionRates()),
  note: "Pro tuto sadu zatím nejsou naměřené šance, používají se průměrné hodnoty éry Mega Evolution.",
  sources: [],
};

export const packProfile = (setId: string): PackProfile => PACKS[setId] ?? DEFAULT_PACK;

/**
 * Očekávaný počet karet každé rarity v jednom balíčku (včetně god packu). Výsledek slotu
 * s více raritami se dělí podle počtu karet každé z nich v sadě (poolSizes).
 */
export function expectedPerPack(profile: PackProfile, poolSizes: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const distribute = (rarities: string[], amount: number) => {
    const sizes = rarities.map((r) => poolSizes.get(r) ?? 0);
    const total = sizes.reduce((a, b) => a + b, 0);
    if (!total) return;
    rarities.forEach((r, i) => out.set(r, (out.get(r) ?? 0) + (amount * sizes[i]) / total));
  };
  const addSlots = (slots: Slot[], weight: number) => {
    for (const slot of slots) {
      let rest = 1;
      for (const hit of slot.hits) {
        const p = hit.p ?? 0;
        rest -= p;
        if (hit.variant === "normal") distribute(hit.rarities, weight * slot.count * p);
      }
      if (slot.base.variant === "normal") distribute(slot.base.rarities, weight * slot.count * rest);
    }
  };
  const god = profile.godPack?.p ?? 0;
  addSlots(profile.slots, 1 - god);
  if (profile.godPack) addSlots(profile.godPack.slots, god);
  return out;
}

/** Celkový počet karet v balíčku. */
export const packSize = (profile: PackProfile): number =>
  profile.slots.reduce((n, s) => n + s.count, 0);

/**
 * Šance na balíček pro každou raritu, která může padnout ve vzácném slotu,
 * přepočtená na tvar „1 : X“ pro zobrazení v obchodě.
 */
export function oddsTable(profile: PackProfile): { label: string; p: number }[] {
  const rows: { label: string; p: number }[] = [];
  for (const slot of profile.slots) {
    for (const hit of slot.hits) {
      const name =
        hit.variant === "normal" ? hit.rarities.join(" / ") : `${VARIANT_LABEL[hit.variant]} (C/U/R)`;
      rows.push({ label: name, p: (hit.p ?? 0) * slot.count });
    }
  }
  if (profile.godPack) rows.push({ label: "God pack (všech 10 karet vzácných)", p: profile.godPack.p });
  return rows.sort((a, b) => b.p - a.p);
}
