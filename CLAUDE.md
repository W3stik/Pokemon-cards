# Booster Lab – poznámky pro agenta

Fanouškovská PWA (Android i Windows přes „Instalovat aplikaci“), ve které si uživatel zdarma bere
a otevírá balíčky **skutečných** sad Pokémon TCG a sbírá karty do alba. Uživatel komunikuje česky,
celé UI i komentáře jsou česky. Návod pro uživatele je v `README.md`.

Repozitář `W3stik/Pokemon-cards` obsahuje jen tuto aplikaci (TypeScript, Vite, bez frameworku,
Vitest). Vznikl vyčleněním složky `pokemon-packs/` z `W3stik/claude-project` i s historií commitů.

## Příkazy

```bash
npm install
npm run dev        # vývojový server http://localhost:5173
npm test           # Vitest: data, šance, generátor, regál (pack.test.ts), stav a záloha (store.test.ts), ceny (prices.test.ts)
npm run build      # tsc --noEmit + vite build → dist/  (vždy před commitem)
npm run e2e        # Playwright průchod celou aplikací nad buildem, snímky v e2e-shots/
                   # (poprvé: npx playwright install chromium); obrázky a API podvrhuje
npm run data       # stáhne 10 nejnovějších sad do public/data (npm run data -- 15 = 15 sad)
npm run prices     # ceny z TCGdex → public/data/prices.json (gitignored, dělá to CI)
npm run images     # obrázky karet → WebP z TCGdex (součást npm run data)
```

Bez frameworku: DOM se staví helperem `h()` z `src/ui/dom.ts`. Routing je hash (`#/shop`,
`#/pick/:setId`, `#/open[/:setId]`, `#/album[/:setId]`, `#/more`) v `src/main.ts`.
Každá obrazovka se kreslí do nového kontejneru (pomalé načítání staré obrazovky nepřepíše novou).

## Mapa kódu

| Soubor | Co dělá |
|---|---|
| `scripts/fetch-data.mjs` | Stáhne sady a karty z GitHubu `PokemonTCG/pokemon-tcg-data` (stejná data jako Pokémon TCG API). Bere 10 nejnovějších booster sad (bez promo apod.), zahodí karty s nečíselným číslem. **Podsady** (`SUBSETS`, nyní `me55c` Classic Collection) slučuje do hlavní sady s raritou „Classic Collection“, prefixem `CC` a přečíslováním 1–30. `MEGA_ATTACK_RARE` přejmenuje na „Mega Attack Rare“. Náhledy z `images.pokemontcg.io` (PNG ~160 kB) nahrazuje stejnými ze Scrydexu (`images.scrydex.com/pokemon/{id}/small`, ~50 kB, ověřeno pro všech 907 karet). |
| `scripts/tcgdex.mjs` | Společné pro skripty nad TCGdex: `getJson`, `pool`, `pairSet` (naše karty ↔ TCGdex: hlavní sada podle čísla **a zároveň jména** – Black Bolt č. 80 má v TCGdex jinou kartu; podsady podle jména, `TCGDEX_SUBSETS`). |
| `scripts/fetch-images.mjs` | Přepíše `img`/`imgLarge` na WebP z TCGdex (`{image}/low.webp` ~17 kB, `{image}/high.webp` ~70 kB místo PNG 50/550 kB); každý soubor ověří HEAD požadavkem, jinak nechá původní (Classic Collection TCGdex obrázky v seznamu nemá). |
| `public/data/*.json` | Commitnutá data: `sets.json` + jeden soubor na sadu (zmenšené karty: id, jméno, číslo, rarita, typy, obrázky). |
| `scripts/fetch-prices.mjs` | Ceny z TCGdex pro všechny karty → `public/data/prices.json` (`{updated, source, cards: {id: {eur, eurReverse, usd, usdReverse}}}`). Sady páruje podle jména, karty podle čísla; podsady (`TCGDEX_SUBSETS`, Classic Collection = TCGdex `30th-c`, jiné číslování) podle normalizovaného jména. Karty bez ceny zkouší znovu na evropském serveru TCGdex (viz Nástrahy). Do `prices.json` zapisuje `stats` po sadách (oceněno, z evropského serveru, bez ceny, chyby) – logy CI bez admin práv nejdou číst, statistika na webu ano. Chybějící ceny doplní z posledního nasazení (`PRICES_FALLBACK_URL`). |
| `src/odds.ts` | **Rarity** (`RARITIES`: pořadí, barva, typ lesku, zda je to „hit“) a **profily balíčků** (`PACKS`): sloty, šance a zdroje pro každou sadu; volitelný `godPack` (Ascended Heroes: 1:500, 4× IR, 3× UR/MAR, 2× SIR, poslední SIR nebo 1:10 MHR – složení i šance jsou herní, komunitní odhad je 1:1500–1:4000). `DEFAULT_PACK` pro sadu bez profilu. |
| `src/pack.ts` | `openPack(profile, pools, rng)` – v každém slotu losuje vzácné výsledky podle šance, jinak výchozí raritu; bez opakování karty+provedení v balíčku. `toSealed/fromSealed` (uložitelná podoba balíčku), `hintLevel` (síla tajného náznaku). God pack se losuje jako první hod (jen u sad s `godPack`); `isGodPack` = všechny karty jsou hit. |
| `src/store.ts` | Stav hry v `localStorage` pod klíčem `pokemon-packs:state:v1`: `packs` (počty neotevřených), `collection` (klíč `idKarty|provedení` → kusy), `firstSeen`, `opened`, `history`, `godPacks` (počet otevřených god packů, v historii `god: true`), `shelf` (regál 10 balíčků na sadu), `sealed` (vybrané balíčky s daným obsahem, jsou součástí `packs`). Každá změna jde přes `mutate()`, která nejdřív znovu načte uložený stav (dvě okna si nepřepisují karty); událost `storage` převezme změny z jiného okna. `sanitize()` kontroluje stav z úložiště i ze zálohy (`parseBackup`, `importState`). |
| `src/storage.ts` | Trvalé úložiště (`navigator.storage.persist`, žádá se po prvních kartách v `main.ts`), datum poslední zálohy a připomínka zálohy. |
| `src/prices.ts` | Ceny: 1) `data/prices.json` z buildu, 2) živě Pokémon TCG API po sadách (limit 8 s na požadavek, jedno opakování při 5xx, po neúspěchu 10 min pauza, cache 12 h v localStorage), 3) `tcgdexPrice` živě pro jednu kartu v detailu. Součty přes `addPrice`/`formatTotal` (měna bez cen se nezobrazí jako 0). |
| `src/tcgdexPricing.js` | Výklad cen TCGdex sdílený aplikací i `scripts/fetch-prices.mjs` (čisté JS + `.d.ts`, aby ho Node spustil bez překladu). |
| `src/data.ts` | Načítání `sets.json` a karet sady (cache), `setIdOfCard`, `cardNumber`. |
| `src/views/shop.ts` | Obchod: „1 balíček“ vede na regál, „10 balíčků“ a „Booster box (36)“ přidají balíčky naslepo; okno „Šance a zdroje“. |
| `src/views/pick.ts` | Regál: 10 předem vylosovaných balíčků (uložené ve `state.shelf`, obnovení stránky je nepřelosuje). Vzatý balíček jde do `sealed` a jeho místo zaplní nový. Balíček s IR/UR a vzácnější kartou má **tajnou jiskřičku** (`hintLevel` 1–3). |
| `src/views/open.ts` | Otevírání: obsah dalšího balíčku se losuje dopředu (`prepare`, do sbírky se zapíše až při roztržení v `draw`), aby se obrázky karet stáhly, než hráč balíček roztrhne; v přehledu se připravuje další. 3D balíček (tažení přes horní pruh = roztržení, jinde = otáčení, klepnutí = roztržení) → karty vyjedou jako 3D balík lícem nahoru → klepnutím/tažením se odhazují → přehled. Vybraný balíček z regálu se otevře s uloženým obsahem (`nextSealed`). Vzácná karta se při odkrytí rozzáří (`revealHit`: burst, u SIR+ záblesk). „Otevřít vše“ seskupuje stejné karty. |
| `src/views/album.ts` | Přehled sad (kompletnost, duplikáty, hodnota) a album sady (filtry, rarita, hledání, řazení podle čísla/rarity/jména/ceny/počtu). |
| `src/views/cardModal.ts` | Detail karty: 3D prohlížeč, počty podle provedení, ceny, celoobrazovkový režim. |
| `src/ui/pack.ts` | 3D model balíčku (`packEl`), rub je vlastní potisk (`backDesign`: barvy sady, zatavené okraje, šev, logo), ID produktů TCGplayer (`PACK_PRODUCTS`) a URL fotek, jiskřička náznaku. Velký balíček začne s malou fotkou a velkou vymění po načtení; poměr stran fotek se pamatuje v localStorage (`pokemon-packs:pack-ratios`); `prefetchPackArt` na regálu a v zásobě. |
| `src/ui/sfx.ts` | Zvuky (syntetizované přes Web Audio, žádné soubory) a vibrace: roztržení, odhození, fanfára podle ranku rarity. `unlockAudio()` volat v obsluze klepnutí. Nastavení `pokemon-packs:fx` (Více, tlačítko 🔊 při otevírání). |
| `src/ui/holo.ts` | 2D karta s holo vrstvami (`cardEl`), naklánění kurzorem/gyroskopem (`enableTilt`), rub karty (`cardBack`, oficiální obrázek + náhradní design), `preload`. |
| `src/ui/card3d.ts` | 3D model karty (líc, rub, hrany) a prohlížeč s tažením, setrvačností, otočením a gyroskopem. |
| `public/sw.js` | Service worker: app shell, soubory buildu a data offline (data stale-while-revalidate, stránka ze sítě s limitem 3 s), obrázky cache-first přes CORS (opaque odpovědi se neukládají kvůli kvótě). Malé obrázky v `card-images` (limit 2000), velké (`_hires`, `/large`, `_in_1000x1000`) v `card-images-large` (limit 150). Řádek `const BUILD = …` při buildu přepíše plugin ve `vite.config.ts` (verze = hash sw.js + názvů souborů), takže se verze mění sama a stará mezipaměť se smaže. `main.ts` pak nabídne „Nová verze – Obnovit“. Rub karty (bez CORS) se jako jediný ukládá i neprůhledný. |

## Data a externí zdroje (co je ověřené)

Ověřováno 12. 10. 2026 z GitHub Actions (sandbox, kde aplikace vznikla, měl na tyto hosty zakázaný přístup):

| Zdroj | Stav |
|---|---|
| `raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data` | funguje, data až po 30th Celebration (září 2026) |
| Obrázky karet `images.pokemontcg.io`, `images.scrydex.com` | 200, CORS `*` |
| Fotky obalů `tcgplayer-cdn.tcgplayer.com/product/{id}_in_1000x1000.jpg` / `_400w.jpg` | 200, CORS `*`; fotky jsou těsně oříznuté (bez bílého okraje), poměr ~0,5–0,55 |
| Rub karty `tcg.pokemon.com/assets/img/global/tcg-card-back-2x.jpg` | 200, **bez CORS** → zobrazí se, ale service worker ho offline neuloží |
| `api.pokemontcg.io/v2/cards` | **nespolehlivé** – střídavě 200 a 500 (projekt přechází na placený Scrydex) |
| TCGdex `api.tcgdex.net/v2/en` | funguje, CORS `*`; ceny má pro všech 10 sad (1755 z 1756 karet), u 30th Celebration a Classic Collection jen Cardmarket (EUR), TCGplayer zatím chybí |
| `tcgcsv.com` (export katalogu TCGplayer) | funguje, vyžaduje vlastní `User-Agent`; odtud jsou ID produktů v `PACK_PRODUCTS` |

ID sad TCGdex: sv10, sv10.5b, sv10.5w, me01, me02, me02.5, me03, me04, me05, 30th.

**Šance na tah** nejsou oficiální. Jsou to měření TCGplayer a komunitní statistiky, zdroje a poznámky
jsou přímo u každého profilu v `src/odds.ts` a zobrazují se v aplikaci. Odhady: Chaos Rising (SIR, MHR),
Black White Rare (1:1789), část 30th Celebration.

### Přidání nové sady

1. `npm run data` (nebo s vyšším počtem). Když sada má podsadu prodávanou ve stejných balíčcích,
   přidej ji do `SUBSETS` ve `scripts/fetch-data.mjs`.
2. Do `PACKS` v `src/odds.ts` přidej profil (sloty, šance, barvy, zdroje). Nové rarity přidej do `RARITIES`.
2. Do `PACK_PRODUCTS` v `src/ui/pack.ts` přidej productId „{Sada} Booster Pack“ z
   `https://tcgcsv.com/tcgplayer/3/groups` → `/{groupId}/products` (hlavička `User-Agent`).
3. `npm test` ověří, že každá rarita z profilu v datech existuje a obráceně, a že součty šancí < 1.

## Nasazení

Workflow `.github/workflows/pages.yml`: test → `npm run prices` (smí selhat) → build →
artefakt → **deploy na GitHub Pages jen z výchozí větve `main`** (push, denní cron 5:17 UTC kvůli cenám,
ruční spuštění). Předpoklad: *Settings → Pages → Source: GitHub Actions*. Adresa:
https://w3stik.github.io/Pokemon-cards/. Vite má `base: "./"`, takže build funguje v podsložce Pages.

Všechny projektové stránky účtu sdílejí origin `https://w3stik.github.io`, tedy i localStorage,
mezipaměti service workeru a trvalé úložiště. Klíče mají prefix `pokemon-packs:`; nenasazuj druhou
kopii aplikace pod stejný účet, service worker by mazal mezipaměť té druhé (`app-*`).

## Nástrahy (naučené na vlastní kůži)

- **Grafická paměť telefonu**: karta (`.pcard`) nesmí být v klidu 3D vrstva (`will-change`, 3D
  transform) – stovky vrstev v albu vyčerpaly paměť a obrázky se po chvíli kreslily se zpožděním.
  3D natočení a odlesk jen s třídou `is-tilting` (přepíná `enableTilt`); dlaždice alba a přehledu
  mají `content-visibility: auto`. Service worker promazává mezipaměť obrázků jen jednou za čas.

- **Service worker a nasazení na Pages**: GitHub Pages při nasazení smaže staré soubory buildu a
  index.html drží v HTTP mezipaměti prohlížeče až 10 min. Proto: precache s `cache: "reload"`,
  stránka se ověřuje u serveru (`cache: "no-cache"`), předchozí `app-*` mezipaměť se nemaže
  (otevřená stará stránka najde své soubory) a index.html se při nenačteném skriptu jednou sám
  obnoví. Režim navigace je `request.mode === "navigate"` (12. 10. 2026 tu byla chyba
  `"navigation"` a aplikace po nasazení zůstala na telefonu prázdná).

- **TCGdex má GeoDNS**: z Evropy `api.tcgdex.net` vede na 51.255.35.48, z USA (runnery GitHub Actions)
  na 142.44.242.175 a servery nemají stejná data – 12. 10. 2026 americký neměl ceny 30th Celebration.
  `fetch-prices.mjs` proto karty bez ceny zkouší na adrese, kterou DNS-over-HTTPS vrátí pro evropskou
  podsíť. Dotaz na konkrétní IP potřebuje vlastní `https.Agent`, jinak keep-alive použije staré spojení.

- **3D v CSS**: přidané roviny uvnitř `preserve-3d` (např. „jádro“ karty mezi lícem a rubem) se
  v balíčku karet protínaly s ostatními kartami a vykukovaly jako světlé obdélníky. Proto karty
  v balíčku při otevírání **nemají hranu**; hrany má jen samostatná karta v prohlížeči (`card3d.ts`).
- Boky balíčku berou barvu z okraje fotky (`background: var(--art) … / 4000% 100%`), ne z barev sady –
  jinak při pohupování svítí barevné pruhy. Boky se k zataveným okrajům zaoblují (`clip-path: inset(… round 999px)`).
- Odtrhávací pruh a zbytek obalu jsou dvě kopie stejné fotky s `clip-path`; pruh má malý přesah,
  jinak je mezi díly vlasová spára. Pruh leží o 0,5 px před zbytkem: ve stejné rovině překryv
  při otáčení přeblikával (z-fighting).
- Točení balíčku: při tažení (`is-dragging`) jen `rotateY(var(--spin))`, bez náklonu podle prstu;
  náklon z gyroskopu je vyhlazený (`holo.ts`) a přechod bez pružného dokmitu – jinak se balíček
  klepal. Boky má i trhací pruh, jinak se z boku „roztrojil“ (oddělené hrany přední a zadní strany).
- Na 3D prvky balíčku nedávej `filter` (ztmavení boků je vrstva gradientu) – Chrome je pak při otáčení
  překresluje a problikávají.
- `calc(var(--x) / 1deg)` (dělení jednotkou) starší prohlížeče neumí – nepoužívat.
- `filter`/`box-shadow` na ploše s `clip-path` se ořízne; zvýraznění dávej na nadřazený prvek.
- Zvýraznění řezu (`.pack3d__cut`) má `box-shadow` – při nulové délce musí mít `opacity: 0`, jinak svítí tečka.
- Animace s `animation-delay` měněnou za běhu nejdou spolehlivě „zmrazit“ pro snímek; v testech
  raději animaci vypni (`animation: none`) a nastav stav natvrdo.
- Esc v celoobrazovkovém prohlížeči se zachytává ve fázi capture, aby nezavřel i detail pod ním.

## Konvence

- Commit zprávy anglicky (rozkazovací věta v předmětu, tělo vysvětluje proč). Před commitem
  `npm test && npm run build`. Neměň víc, než úkol vyžaduje; nepřidávej závislosti bez důvodu.

- Texty UI, komentáře a hlášky česky; názvy rarit a sad anglicky (oficiální).
- Stav hry měň jen přes funkce ze `store.ts` (ukládají a volají posluchače). Při nekompatibilní
  změně schématu zvyš verzi klíče a doplň migraci (`load()` dnes doplňuje chybějící pole z `empty()`).
- Žádné reklamy ani zpoplatnění: obrázky a jména patří Nintendo / The Pokémon Company; projekt je
  soukromý fanouškovský (upozornění v `README.md` a v sekci Více).

## Nápady na další práci (neudělané)

Seřazeno podle přínosu:

1. Herní ekonomika: prodej duplikátů za mince podle tržní ceny, nákup balíčků za mince.
2. „Master set“ v albu: kompletnost včetně reverse/Poké Ball/Master Ball provedení; statistiky nejlepších tahů a historie hodnoty sbírky.
3. Synchronizace sbírky mezi zařízeními (dnes jen ruční záloha do souboru).
4. Starší sady / automatická kontrola nových sad v CI (nová sada bez profilu v `PACKS` použije `DEFAULT_PACK`).
5. Virtualizace mřížky alba pro velké sady (Ascended Heroes má 295 karet) a `npm run e2e` v CI.
