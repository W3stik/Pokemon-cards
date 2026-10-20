# Booster Lab – poznámky pro agenta

Fanouškovská PWA (Android i Windows přes „Instalovat aplikaci“), ve které si uživatel zdarma bere
a otevírá balíčky **skutečných** sad Pokémon TCG a sbírá karty do alba. Uživatel komunikuje česky,
komentáře v kódu jsou česky. UI je česky nebo anglicky podle jazyka zařízení (slovníky v `src/i18n/`). Návod pro uživatele je v `README.md`.

Repozitář `W3stik/Pokemon-cards` obsahuje jen tuto aplikaci (TypeScript, Vite, bez frameworku,
Vitest). Vznikl vyčleněním složky `pokemon-packs/` z `W3stik/claude-project` i s historií commitů.

## Příkazy

```bash
npm install
npm run dev        # vývojový server http://localhost:5173
npm test           # Vitest: data, šance, generátor, regál (pack.test.ts), stav a záloha (store.test.ts), ceny (prices.test.ts), jazyk a překlad (i18n.test.ts), nastavení zvuku (sfx.test.ts)
npm run build      # tsc --noEmit + vite build → dist/  (vždy před commitem)
npm run e2e        # Playwright průchod celou aplikací nad buildem, snímky v e2e-shots/ (běží i v CI před nasazením)
                   # (poprvé: npx playwright install chromium); obrázky a API podvrhuje
npm run data       # stáhne sady ér SERIES + EXTRA_SETS do public/data (pak i obrázky z TCGdex)
npm run prices     # ceny z TCGdex → public/data/prices.json (gitignored, dělá to CI)
npm run images     # obrázky karet → WebP z TCGdex (součást npm run data)
```

Bez frameworku: DOM se staví helperem `h()` z `src/ui/dom.ts`. Routing je hash (`#/shop`,
`#/pick/:setId`, `#/open[/:setId]`, `#/album[/:setId]`, `#/stats`, `#/replay/:at`, `#/more`) v `src/main.ts`.
Styly jsou v `src/styles/` po oblastech; pořadí importů v `index.css` je pořadí kaskády.
Každá obrazovka se kreslí do nového kontejneru (pomalé načítání staré obrazovky nepřepíše novou).

## Mapa kódu

| Soubor | Co dělá |
|---|---|
| `scripts/fetch-data.mjs` | Stáhne sady a karty z GitHubu `PokemonTCG/pokemon-tcg-data` (stejná data jako Pokémon TCG API). Bere všechny booster sady ér `SERIES` (Mega Evolution, Scarlet & Violet) a vybrané starší `EXTRA_SETS` (Evolving Skies), bez promo apod.; zahodí karty s nečíselným číslem. U éry Sword & Shield označí alt arty (`markAltArts`: druhá ze dvou po sobě jdoucích karet téhož Pokémona → „Alternate Art“ / „Alternate Art VMAX“; ve zdroji mají stejnou raritu jako full art / rainbow). **Podsady** (`SUBSETS`, nyní `me55c` Classic Collection) slučuje do hlavní sady s raritou „Classic Collection“, prefixem `CC` a přečíslováním 1–30. `MEGA_ATTACK_RARE` přejmenuje na „Mega Attack Rare“. `RARITY_FIXES` opravuje chyby zdroje (Victini BB 171 / WF 172 = Black White Rare, Archen WF 131 = Illustration Rare; ve zdroji Rare/Uncommon, takže by drahé karty padaly jako obyčejné). Test hlídá, že karty za hranicí sady nemají obyčejnou raritu. Náhledy z `images.pokemontcg.io` (PNG ~160 kB) nahrazuje stejnými ze Scrydexu (`images.scrydex.com/pokemon/{id}/small`, ~50 kB, ověřeno pro všech 907 karet). |
| `scripts/tcgdex.mjs` | Společné pro skripty nad TCGdex: `getJson`, `pool`, `pairSet` (naše karty ↔ TCGdex: hlavní sada podle čísla **a zároveň jména** – Black Bolt č. 80 má v TCGdex jinou kartu; podsady podle jména, `TCGDEX_SUBSETS`). |
| `scripts/fetch-images.mjs` | Přepíše `img`/`imgLarge` na WebP z TCGdex (`{image}/low.webp` ~17 kB, `{image}/high.webp` ~70 kB místo PNG 50/550 kB); každý soubor ověří HEAD požadavkem, jinak nechá původní (Classic Collection TCGdex obrázky v seznamu nemá). |
| `public/data/*.json` | Commitnutá data: `sets.json` + jeden soubor na sadu (zmenšené karty: id, jméno, číslo, rarita, typy, obrázky). |
| `scripts/fetch-prices.mjs` | Ceny z TCGdex pro všechny karty → `public/data/prices.json` (`{updated, source, cards: {id: {eur, eurReverse, usd, usdReverse}}}`). Sady páruje podle jména, karty podle čísla; podsady (`TCGDEX_SUBSETS`, Classic Collection = TCGdex `30th-c`, jiné číslování) podle normalizovaného jména. Karty bez ceny zkouší znovu na evropském serveru TCGdex (viz Nástrahy). Do `prices.json` zapisuje `stats` po sadách (oceněno, z evropského serveru, bez ceny, chyby) – logy CI bez admin práv nejdou číst, statistika na webu ano. Chybějící ceny doplní z posledního nasazení (`PRICES_FALLBACK_URL`). |
| `src/odds.ts` | **Rarity** (`RARITIES`: pořadí, barva, typ lesku, zda je to „hit“) a **profily balíčků** (`PACKS`): sloty, šance a zdroje pro každou sadu; volitelný `godPack` (Ascended Heroes: 1:500, 4× IR, 3× UR/MAR, 2× SIR, poslední SIR nebo 1:10 MHR – složení i šance jsou herní, komunitní odhad je 1:1500–1:4000). `DEFAULT_PACK` pro sadu bez profilu. |
| `src/pack.ts` | `openPack(profile, pools, rng)` – v každém slotu losuje vzácné výsledky podle šance, jinak výchozí raritu; bez opakování karty+provedení v balíčku. `toSealed/fromSealed` (uložitelná podoba balíčku), `hintLevel` (síla tajného náznaku). God pack se losuje jako první hod (jen u sad s `godPack`); `isGodPack` = všechny karty jsou hit. |
| `src/store.ts` | Stav hry v `localStorage` pod klíčem `pokemon-packs:state:v1`: `packs` (počty neotevřených), `collection` (klíč `idKarty|provedení` → kusy), `firstSeen`, `opened`, `history`, `godPacks` (počet otevřených god packů, v historii `god: true`), `shelf` (regál 10 balíčků na sadu), `sealed` (vybrané balíčky s daným obsahem, jsou součástí `packs`), `hallOfFame` (jen god packy, limit 500). Otevření zapisuje `recordOpening`, „Otevřít vše“ `recordOpenings` jedním uložením (stav s plnou sbírkou má kolem 1 MB, uložení pro každý balíček zvlášť bylo znát). Každá změna jde přes `mutate()`, která nejdřív znovu načte uložený stav (dvě okna si nepřepisují karty); událost `storage` převezme změny z jiného okna. `sanitize()` kontroluje stav z úložiště i ze zálohy (`parseBackup`, `importState`). Když se uložení nepovede (plné úložiště, anonymní okno), hra běží ze stavu v paměti a `storageFailed()` to hlásí – `main.ts` ukáže varování s odkazem na zálohu (zmizí, až se uložení zase povede). |
| `src/storage.ts` | Trvalé úložiště (`navigator.storage.persist`, žádá se po prvních kartách v `main.ts`), datum poslední zálohy a připomínka zálohy. |
| `src/prices.ts` | Ceny: `data/prices.json` z buildu (TCGdex, obnovuje CI denně) a `tcgdexPrice` živě pro jednu kartu v detailu. Záloha přes Pokémon TCG API je pryč (API je nespolehlivé a TCGdex má ceny všech sad); staré klíče `pokemon-packs:prices:*` se z localStorage mažou. Součty přes `addPrice`/`formatTotal` (měna bez cen se nezobrazí jako 0). |
| `src/tcgdexPricing.js` | Výklad cen TCGdex sdílený aplikací i `scripts/fetch-prices.mjs` (čisté JS + `.d.ts`, aby ho Node spustil bez překladu). |
| `src/i18n/` | Jazyk: `index.ts` určí jazyk při načtení (`detectLang`: první čeština/slovenština → `cs`, angličtina nebo nic → `en`; ruční volba `pokemon-packs:lang` v sekci Více, změna obnoví stránku), `locale` pro `Intl` (`cs-CZ` / `en-GB`, aby i anglické datum bylo den–měsíc–rok), `t` = slovník. `cs.ts` a `en.ts`: texty po oblastech (`t.shop.title`, `t.common.cards(n)` se skloňováním); `en` má typ `Messages = typeof cs`, chybějící text je chyba překladu TypeScriptu. U dat jsou texty v obou jazycích jako `Text` (`{ cs, en }`, např. `note` v `odds.ts`) a čtou se přes `tx()`. Test `i18n.test.ts` hlídá, že v kódu mimo `cs.ts` nezůstal český řetězec (písmena ěščřžůťďň). |
| `src/data.ts` | Načítání `sets.json` a karet sady (cache), `setIdOfCard`, `setOfCard` (sada karty včetně podsad, používá album i statistiky), `cardNumber`. |
| `src/ui/eras.ts` | Třídění podle éry: `groupBySeries`, rozbalovací `eraSection` (obsah se vytvoří až při otevření, stav v localStorage `pokemon-packs:eras:*`), `plural`. Používá obchod, inventář (nadpisy) a přehled alba. |
| `src/views/shop.ts` | Obchod: „1 balíček“ vede na regál, „10 balíčků“ a „Booster box (36)“ přidají balíčky naslepo; okno „Šance a zdroje“. |
| `src/views/pick.ts` | Regál: 10 předem vylosovaných balíčků (uložené ve `state.shelf`, obnovení stránky je nepřelosuje). Vzatý balíček jde do `sealed` a jeho místo zaplní nový. Balíček s IR/UR a vzácnější kartou má **tajnou jiskřičku** (`hintLevel` 1–3). Balíčky jsou lehké náhledy (`packThumb` s jiskřičkou, pohupování `.shelf__sway`); vybraný se ukáže jako 3D model z `packModel.ts` – jeden pro celý regál, při výběru jiného se přesune a resetuje, dotyky nebere (jdou na tlačítko slotu), šířku `--model-w` dorovnává na výšku náhledu. Na regálu plátno modelu nepřesahuje balíček a `.shelf` má `overflow-x: clip` – jinak se u krajního sloupce dala stránka na mobilu posouvat do stran. |
| `src/views/open.ts` (+ `openPile.ts`, `openSummary.ts`, `openCssPack.ts`) | Otevírání (`open.ts`: výběr sady, `OpeningStage` s balíčkem, roztržením a „Otevřít vše“; `openPile.ts`: balík karet a odhalování; `openSummary.ts`: přehled; `openCssPack.ts`: záložní CSS balíček bez WebGL): obsah dalšího balíčku se losuje dopředu (`prepare`, do sbírky se zapíše až při roztržení v `draw`), aby se obrázky karet stáhly, než hráč balíček roztrhne; v přehledu se připravuje další. 3D balíček (tažení přes horní pruh = roztržení, jinde = otáčení, klepnutí = roztržení) → obal zůstane a karty z něj vyjedou (3D model se přesune do `.pile__pack` nad balík karet a zakrývá jeho spodek, balík se vysune `is-rising`, pak `drop()` obal odveze dolů) → horní karty se odhazují → přehled. Vybraný balíček z regálu se otevře s uloženým obsahem (`nextSealed`). **Odhazování karet** (`openPile.ts`): horní karta sleduje prst (natočení podle místa úchopu) a odletí švihem (> 0,5 px/ms, směrem švihu) nebo odtažená o ≥ 35 % (směrem tahu), méně se vrátí; klepnutí / Enter / mezerník ji odhodí doleva, šipky do strany (`throwAway`). Vzácné karty nejsou rubem nahoru (vytahování zezadu uživatel nechtěl): zpoza horní karty prosvítá aura v barvě rarity karty pod ní (`pile--tease`, při tahu `pile--pulling`), efekty (`revealHit` → `src/ui/reveal.ts`: úroveň `tierOf(rank)`; tlaková vlna, hvězdičky, paprsky, reflektor, nápis rarity, barevný záblesk, zlatý déšť a otřes) přijdou, když se karta dostane nahoru (`revealCurrent`). Karty leží rovně (z balíku nevykukují). **Světlo z balíčku**: když karty vyjíždějí, z trhliny vyšlehne vějíř paprsků (`.pile__light`, za kartami, spodek zakryje obal) v barvě nejvzácnější karty (bez vzácné bílé), u vzácnějších silnější, od SIR blikající, od IR i zvuk napětí. **Hodnota** odhalených karet je v horním řádku obrazovky (`value` z `OpeningStage`, ne pod kartou – uživatel to tak chtěl), přičítá se, jak se karty dostávají nahoru; od 2 €/$ výraznější poskočení. **Podržení** horní karty (450 ms bez pohybu) ji otevře ve 3D přes celou obrazovku (`openCardViewer` z `cardModal.ts`). **God pack se předem neprozradí**: zlatá záře (`pile--god`) a nápis `godBanner` až po odhalení poslední karty (`announceGod`). „Otevřít vše“ seskupuje stejné karty a ukládá jedním zápisem. Model balíčku (`this.model`) je jeden pro celou obrazovku, „Otevřít další“ ho jen resetuje. **Klávesnice**: Enter/mezerník roztrhne balíček a odhazuje karty, šipky do strany, v přehledu Enter otevře další (posluchač na `document`, ignoruje tlačítka, pole a otevřená okna). **Přehrávání** (`renderReplay`, `#/replay/<at>`): god pack ze Síně slávy se otevře znovu se stejnými kartami (`replay`), nic se nezapisuje. |
| `src/views/album.ts` | Přehled sad (kompletnost, duplikáty, hodnota – počítá se jen ze sbírky a `sets.json`, bez načítání karet všech sad) a album sady (filtry, rarita, hledání s prodlevou 160 ms, řazení podle čísla/rarity/jména/ceny/počtu). |
| `src/views/stats.ts` | Statistiky (`#/stats`, odkaz z alba): **měřák štěstí** (skutečné kusy podle rarity ze sbírky proti `opened × expectedPerPack`, souhrn od IR výš, filtr sady) a **Síň slávy** (`state.hallOfFame`: natrvalo jen god packy se všemi kartami, doplní se i z historie; každý jde „▶ Otevřít znovu“ → `#/replay/<at>`; řazení nejnovější/nejcennější od dvou záznamů). Dřívější verze ukládala i balíčky s UR a vzácnějšími, `sanitize()` je při načtení vyřadí. |
| `src/views/cardModal.ts` | Detail karty: 3D prohlížeč, počty podle provedení, ceny, celoobrazovkový režim (vlastní Zpět, Esc a Tab nad detailem). |
| `src/ui/modal.ts`, `src/ui/history.ts` | Modální okno (`openModal`). `closeOnBack`: okno si přidá záznam do historie, takže **Zpět na Androidu zavře jen okno**; při zavření jinak se záznam odebere (`history.back()`, vlastní popstate se ignorují). Okna tvoří zásobník, Zpět zavře vrchní. `trapFocus` drží Tab uvnitř okna. |
| `src/ui/pack.ts` | `packThumb`: lehký náhled (fotka + naklánění, volitelně jiskřička `hint`) pro obchod, inventář a regál; `packRatio`; náhledy jsou všechny stejně vysoké jako balíček s poměrem `PACK_RATIO` = 0,547 (fotka 30th Celebration má 0,497 – při stejné šířce byla o 10 % vyšší než ostatní), užší balíček je užší; 3D model balíčku z CSS (`packEl`) už jen jako záloha bez WebGL, rub je vlastní potisk (`backDesign`: barvy sady, zatavené okraje, šev, logo), ID produktů TCGplayer (`PACK_PRODUCTS`) a URL fotek, jiskřička náznaku. Velký balíček začne s malou fotkou a velkou vymění po načtení; poměr stran fotek se pamatuje v localStorage (`pokemon-packs:pack-ratios`); `prefetchPackArt` na regálu a v zásobě. |
| `src/ui/packModel.ts` | **3D model balíčku ve WebGL** (bez knihovny) pro obrazovku otevírání: uzavřený „polštářek“ (tloušťka `thickness(u, v)`, nulová na krajích a v zatavených okrajích), horní pruh je samostatná síť se společnou hranou (`CUT_V`). Líc = fotka obalu (malá, pak velká; textura 1024×2048 s mipmapami), rub = canvas v barvách profilu sady (`drawBack`: záře doplňkové barvy, šev, logo, drobný text, čárový kód; světlý obal → tmavý text). Shader: difuzní světlo, odlesk fólie, řez při tahu, jiskřička náznaku. Ovládání jako `card3d` (tažení, setrvačnost, vyhlazený gyroskop, houpání). **Trhání prstem**: směr určí první tah, horní pruh se za čelem trhliny odlupuje a přeloží zpět přes obal k prstu (ohyb ve vertex shaderu, `uBend*`; po puštění se trochu narovná, ale nezacelí se), trhlina má roztřepený okraj s bílými vlákny (fragment shader `jag()`, obě části přesahují řez o `JAG` a přebytek zahodí `discard`); postup hlásí `onCut` → `sfxRip` (praskání fólie, cvaknutí vibrace). Plátno přesahuje balíček o 25 % na každou stranu (odlétající pruh se neořízne), dotyky bere obdélník balíčku `el`. Roztržení `tear()` (trhlina se dotrhne, pruh odletí ve směru tahu, obal se natočí zepředu a zůstane – karty z něj vyjíždějí), `drop()` obal odveze dolů, `reset()` pro další balíček (bez nového kontextu WebGL a textur). Mimo stránku (karty, přehled) se smyčka pozastaví; kontext se uvolní až po odchodu z obrazovky (`alive`). Bez WebGL `open.ts` použije CSS balíček (`cssPack`). |
| `src/ui/reveal.ts` | Efekty odhalení vzácné karty podle úrovně rarity (`tierOf`, `CHARGE_MS`, `shockwave`, `stars`, `rays`, `flash`, `rarityBanner`, `goldRain`, `shake`). CSS v `src/styles/reveal.css`; nabíjení animuje vnitřní `.flip`, ne `.pile__item` (ta má animaci vyjetí, která by se jinak spustila znovu). |
| `src/ui/sfx.ts` | Zvuky (syntetizované přes Web Audio, žádné soubory) a vibrace. Řetězec `createEngine`: zdroje → suchý / dozvuk (konvoluce s generovanou odezvou místnosti) → kompresor → hlasitost. Stavební kameny: FM zvonky (`bell`), supersaw plochy (`pad`), šumové švihy se stereo pohybem (`whoosh`), dopad (`impact`), činel, `riser`, tlukot srdce, šustění fólie (`crinkle`), třpyt (pentatonika). Zvuky událostí jsou v `SOUNDS` (roztržení, vyjetí karet, odhození na stranu letu, nabití, otočení, odhalení podle úrovně, god pack znělka). Hlasitosti jsou vyrovnané měřením (vykreslení přes `OfflineAudioContext`, viz Nástrahy). `unlockAudio()` volat v obsluze klepnutí. Po 8 s ticha a při skrytí aplikace se kontext uspí (`suspend`, šetří baterii), další zvuk ho probudí – i ze stavu „interrupted“ na iPhonu. Nastavení `pokemon-packs:fx` (zvuk, vibrace, hlasitost) kontroluje `sanitizeFxPrefs`; v sekci Více posuvník hlasitosti a ukázky zvuků (při vypnutém zvuku zašedlé). Na obrazovce otevírání tlačítko pro ztlumení není (uživatel ho nechtěl). |
| `src/ui/holo.ts` | 2D karta s holo vrstvami (`cardEl`; typ lesku `shine-*` podle `RARITIES.shine`: holo, ex, cosmos (Classic Collection), illus (třpytky), etched (rýhy), sir, gold, neon (Futuristic), dark (BWR); vrstvy `--glitter`, `--rainbow`, `--etch` jsou v `.pcard`), naklánění kurzorem/gyroskopem (`enableTilt`), rub karty (`cardBack`, oficiální obrázek + náhradní design), `preload`. |
| `src/ui/card3d.ts` | 3D model karty (líc, rub, hrany) a prohlížeč s tažením, setrvačností, otočením a gyroskopem. |
| `public/sw.js` | Service worker: app shell a soubory buildu (`app-<verze>`), data v mezipaměti `card-data` (stale-while-revalidate, nová verze aplikace je znovu nestahuje, jen doplní chybějící sady a obnoví `sets.json`), stránka ze sítě s limitem 3 s, obrázky cache-first přes CORS (opaque odpovědi se neukládají kvůli kvótě). Malé obrázky v `card-images` (limit 2000), velké (`_hires`, `/large`, `_in_1000x1000`) v `card-images-large` (limit 150). Řádek `const BUILD = …` při buildu přepíše plugin ve `vite.config.ts` (verze = hash sw.js + názvů souborů), takže se verze mění sama a stará mezipaměť se smaže. `main.ts` pak nabídne „Nová verze – Obnovit“. Rub karty (bez CORS) se jako jediný ukládá i neprůhledný. |

## Data a externí zdroje (co je ověřené)

Ověřováno 12. 10. 2026 z GitHub Actions (sandbox, kde aplikace vznikla, měl na tyto hosty zakázaný přístup):

| Zdroj | Stav |
|---|---|
| `raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data` | funguje, data až po 30th Celebration (září 2026) |
| Obrázky karet `images.pokemontcg.io`, `images.scrydex.com` | 200, CORS `*` |
| Fotky obalů `tcgplayer-cdn.tcgplayer.com/product/{id}_in_1000x1000.jpg` / `_400w.jpg` | 200, CORS `*`; fotky jsou těsně oříznuté (bez bílého okraje), poměr ~0,5–0,55 |
| Rub karty `tcg.pokemon.com/assets/img/global/tcg-card-back-2x.jpg` | 200, **bez CORS** → zobrazí se, ale service worker ho offline neuloží |
| `api.pokemontcg.io/v2/cards` | **nespolehlivé** – střídavě 200 a 500 (projekt přechází na placený Scrydex); aplikace ho od 13. 10. 2026 nepoužívá |
| TCGdex `api.tcgdex.net/v2/en` | funguje, CORS `*`; ceny má pro všech 24 sad (všech 4 818 karet; Black Bolt č. 80 po opravě čísla), u 30th Celebration a Classic Collection jen Cardmarket (EUR), TCGplayer zatím chybí |
| `tcgcsv.com` (export katalogu TCGplayer) | funguje, vyžaduje vlastní `User-Agent`; odtud jsou ID produktů v `PACK_PRODUCTS` |

ID sad TCGdex: sv10, sv10.5b, sv10.5w, me01, me02, me02.5, me03, me04, me05, 30th.

**Šance na tah** nejsou oficiální. Jsou to měření TCGplayer a komunitní statistiky, zdroje a poznámky
jsou přímo u každého profilu v `src/odds.ts` a zobrazují se v aplikaci. Odhady: Chaos Rising (SIR, MHR),
Black White Rare (1:1789), část 30th Celebration.

### Přidání nové sady

1. Novou éru přidej do `SERIES`, jednotlivou starší sadu do `EXTRA_SETS` ve `scripts/fetch-data.mjs`
   a spusť `npm run data` (stáhne i WebP obrázky z TCGdex). Když sada má podsadu prodávanou ve stejných
   balíčcích, přidej ji do `SUBSETS` (a do `TCGDEX_SUBSETS` ve `scripts/tcgdex.mjs` kvůli cenám).
2. Zkontroluj rarity proti TCGdex (viz audit v historii: Victini, Archen) a u starších ér skryté rarity
   (alt arty Sword & Shield).
3. Do `PACKS` v `src/odds.ts` přidej profil (sloty, šance, barvy obalu, poznámka, zdroje). Nové rarity přidej do
   `RARITIES` (rank, barva, typ lesku). Standardní sady SV: `standardSlots(svRates({ … aceSpec }))`.
4. Do `PACK_PRODUCTS` v `src/ui/pack.ts` přidej productId „{Sada} Booster Pack“ z
   `https://tcgcsv.com/tcgplayer/3/groups` → `/{groupId}/products` (hlavička `User-Agent`).
5. `npm test` ověří, že každá sada má profil i fotku, každá rarita z profilu v datech existuje a obráceně,
   součty šancí < 1 a tajné karty nemají obyčejnou raritu.

## Nasazení

Workflow `.github/workflows/pages.yml`: test → `npm run prices` (smí selhat) → build → **`npm run e2e`** (Playwright; když selže, nenasadí se a snímky jsou v artefaktu `e2e-shots`) →
artefakt → **deploy na GitHub Pages jen z výchozí větve `main`** (push, denní cron 5:17 UTC kvůli cenám,
ruční spuštění). Předpoklad: *Settings → Pages → Source: GitHub Actions*. Adresa:
https://w3stik.github.io/Pokemon-cards/. Vite má `base: "./"`, takže build funguje v podsložce Pages.

Všechny projektové stránky účtu sdílejí origin `https://w3stik.github.io`, tedy i localStorage,
mezipaměti service workeru a trvalé úložiště. Klíče mají prefix `pokemon-packs:`; nenasazuj druhou
kopii aplikace pod stejný účet, service worker by mazal mezipaměť té druhé (`app-*`).

## Nástrahy (naučené na vlastní kůži)

- **`loading="lazy"` musí být nastavené před `src`** (obrázek se stahuje hned po nastavení src). Helper
  `h()` proto nastavuje `loading`/`decoding` jako první. Do 13. 10. 2026 to bylo obráceně a album
  stahovalo všechny obrázky naráz (Ascended Heroes 244 požadavků, viditelné karty čekaly ve frontě).

- Ve skrytém panelu prohlížeče (Claude Browser, headless) CSS animace neběží a snímek zachytí jejich začátek. Pro snímky efektů animace zastav: `document.getAnimations().forEach(a => { a.pause(); a.currentTime = 450 })`.
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
  Data sad (`card-data`) přežívají nové verze: změněný soubor existující sady se k uživateli dostane
  až při dalším načtení (stale-while-revalidate). Při zásadní změně dat (jiná id karet) mezipaměť
  přejmenuj (`DATA_CACHE`), aby se stáhla znovu, a starou smaž v `activate`.

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
- Barvy rubu balíčku z fotky obalu nejdou: převládá žluté logo Pokémon a barvy postav (zkoušeno
  průměrem, histogramem odstínů i okraji fotky). Proto se berou z profilu sady (`colors` v `odds.ts`).
- CDN TCGplayeru posílá `Vary: Origin` jen na požadavky s Origin: kopie z HTTP mezipaměti bez CORS
  pak rozbije načtení s `crossOrigin` (WebGL textura). Service worker při selhání CORS zkusí `cache: "reload"`.
- (CSS balíček, dnes jen záloha bez WebGL a malé balíčky v obchodě/regálu) Točení balíčku: při tažení (`is-dragging`) jen `rotateY(var(--spin))`, bez náklonu podle prstu;
  náklon z gyroskopu je vyhlazený (`holo.ts`) a přechod bez pružného dokmitu – jinak se balíček
  klepal. Boky má i trhací pruh, jinak se z boku „roztrojil“ (oddělené hrany přední a zadní strany).
- Na 3D prvky balíčku nedávej `filter` (ztmavení boků je vrstva gradientu) – Chrome je pak při otáčení
  překresluje a problikávají.
- `calc(var(--x) / 1deg)` (dělení jednotkou) starší prohlížeče neumí – nepoužívat.
- `filter`/`box-shadow` na ploše s `clip-path` se ořízne; zvýraznění dávej na nadřazený prvek.
- Zvýraznění řezu (`.pack3d__cut`) má `box-shadow` – při nulové délce musí mít `opacity: 0`, jinak svítí tečka.
- Animace s `animation-delay` měněnou za běhu nejdou spolehlivě „zmrazit“ pro snímek; v testech
  raději animaci vypni (`animation: none`) a nastav stav natvrdo.
- **Otáčení karty v balíku** (`flip-reveal`, `charge` v `reveal.css`): `translate` musí být před `rotateY` – po
  otočení o 180° míří `translateZ` dozadu a karta se zabořila do karet pod sebou (v god packu jich je devět).
  Při otáčení míří okraj karty dozadu až o půl šířky (~150 px), proto se karta zvedá o 165 px × sin úhlu;
  snímky jsou spočítané předem, časování lineární (pružný přeskok by ji na konci zatlačil pod balík).
- **Ladění zvuků**: zvuk nejde ověřit poslechem v CI ani skrytém prohlížeči. `createEngine` funguje nad
  `OfflineAudioContext`: ve vývojovém serveru `await import("/src/ui/sfx.ts")`, vykreslit `SOUNDS.*` a měřit špičku
  a krátkodobou hlasitost (RMS v oknech 300 ms). Stav 14. 10. 2026: švihy −31 až −37 dB, roztržení −28, nabití
  −21 až −28, odhalení −24 (RR) až −15,5 (zlatá), god pack −15,4, špička nejvýš −4 dB. Malé reproduktory telefonu
  nehrají pod ~200 Hz, proto mají dopady a tlukot srdce zkreslení (alikvoty).
- **Model balíčku (WebGL)**: uniformy sdílené vertex a fragment shaderem musí mít stejnou přesnost; fragment shader bez
  highp by se nesestavil, proto má ohyb pruhu vlastní uniformy `uBend*` (fragment používá `uCut`, `uDir`). V zatavených
  okrajích a v horním pruhu leží přední a zadní stěna na sobě (tloušťka 0): o pořadí rozhodovalo vykreslení a zezadu
  (i u přeloženého pruhu) vyhrával šedý vnitřek místo potisku. Fragment shader proto rub stěny (`!gl_FrontFacing`)
  zahodí, kde je tloušťka ~0 (`vThick`); stříbrný vnitřek se kreslí jen tam, kde má obal tloušťku. Ve skrytém panelu prohlížeče neběží requestAnimationFrame: snímek animace roztržení
  jde udělat jen s podvrženým časem (`performance.now` a `requestAnimationFrame` vrací pevnou hodnotu) a s prodlouženou
  pojistkou `sleep(2600)` v `open.ts`.
- `setIdOfCard` vrací předponu id karty: u podsad je to `me55c`, ale karty podsady jsou v souboru hlavní sady
  (`me55.json`, `me55c.json` neexistuje a server místo něj vrátí index.html → „Unexpected token '<'“). Karty načítej
  podle sady balíčku (`record.setId`) nebo `setOfCard`; ceny (`prices.json`) jsou naopak po předponách, tam `setIdOfCard` sedí.
- Seznamy, které po načtení cen překreslují celé prvky, dělaly e2e nestabilní (klepnutí trefilo odkaz, který mezitím
  zmizel). Album a Síň slávy proto ceny doplňují do hotových prvků; celé překreslení jen při řazení podle ceny.
- E2e v CI: neúspěšné kontroly a pády vypisuje jako anotace GitHubu (`::error`), ty jdou přečíst bez přihlášení
  přes API (`/repos/W3stik/Pokemon-cards/check-runs/{job}/annotations`); logy vyžadují přihlášení. Při pádu je
  v `e2e-shots/x-pad.png` snímek a v hlášce adresa a začátek textu stránky.
- Esc a Tab v celoobrazovkovém prohlížeči se zachytávají ve fázi capture, aby nezavřely detail pod ním
  (Tab by jinak focus trap detailu přesunul zpět do detailu).
- Okno zavřené jinak než Zpět volá `history.back()`; ten je asynchronní a jeho popstate se nesmí
  brát jako Zpět dalšího okna (`ownBacks` v `history.ts`). Id záznamu obsahuje `performance.timeOrigin`,
  po obnovení stránky s otevřeným oknem by se jinak id opakovala.

## Konvence

- Commit zprávy anglicky (rozkazovací věta v předmětu, tělo vysvětluje proč). Před commitem
  `npm test && npm run build`. Neměň víc, než úkol vyžaduje; nepřidávej závislosti bez důvodu.

- Komentáře česky. Texty UI a hlášky jen přes slovníky `src/i18n/cs.ts` + `en.ts` (nový text do obou); názvy rarit, sad a karet anglicky (oficiální). E2e běží s jazykem prohlížeče `cs-CZ` a krátce i `en-US` (bez nastaveného jazyka by Playwright převzal jazyk systému a v CI by byla aplikace anglicky).
- Stav hry měň jen přes funkce ze `store.ts` (ukládají a volají posluchače). Při nekompatibilní
  změně schématu zvyš verzi klíče a doplň migraci (`load()` dnes doplňuje chybějící pole z `empty()`).
- Žádné reklamy ani zpoplatnění: obrázky a jména patří Nintendo / The Pokémon Company; projekt je
  soukromý fanouškovský (upozornění v `README.md` a v sekci Více).

## Nápady na další práci (neudělané)

Seřazeno podle přínosu:

1. Herní ekonomika: prodej duplikátů za mince podle tržní ceny, nákup balíčků za mince.
2. „Master set“ v albu: kompletnost včetně reverse/Poké Ball/Master Ball provedení; statistiky nejlepších tahů a historie hodnoty sbírky.
3. Synchronizace sbírky mezi zařízeními (dnes jen ruční záloha do souboru).
4. Další starší sady (Sword & Shield: Crown Zenith s Galarian Gallery, Lost Origin… s Trainer Gallery jako podsadami) / automatická kontrola nových sad v CI (nová sada bez profilu v `PACKS` použije `DEFAULT_PACK`).
5. Virtualizace mřížky alba pro velké sady (Ascended Heroes má 295 karet).
