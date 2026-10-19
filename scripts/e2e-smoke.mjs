// Kouřový test celé aplikace v Chromiu (Playwright): obchod (éry) → regál → otevření
// balíčku (3D model ve WebGL) → album → 3D detail karty (Esc, Zpět) → statistiky →
// přehrání god packu ze Síně slávy (klávesnicí). Obrázky a API se
// podvrhují, takže test běží i bez internetu a nezávisí na cizích serverech.
// Spouští se i v CI před každým nasazením (.github/workflows/pages.yml).
//
//   npm run build && npm run e2e            (snímky obrazovky uloží do e2e-shots/)
//
// Při prvním použití je potřeba prohlížeč: npx playwright install chromium
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "e2e-shots");
await mkdir(SHOTS, { recursive: true });

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`;
const CARD = svg(245, 342, '<rect width="245" height="342" rx="10" fill="#f2d54b"/><rect x="10" y="10" width="225" height="322" rx="6" fill="#6aa8e8"/>');
const PACK = svg(547, 1000, '<rect width="547" height="1000" fill="#3b1d6e"/><circle cx="273" cy="480" r="170" fill="#ffd54f"/><rect width="547" height="70" fill="#ccc"/><rect y="950" width="547" height="50" fill="#ccc"/>');
const BACK = svg(660, 921, '<rect width="660" height="921" rx="30" fill="#2a5aa8"/><circle cx="330" cy="460" r="150" fill="#d33"/>');

const server = await preview({ root: ROOT, preview: { port: 4173, strictPort: false }, logLevel: "warn" });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const failures = [];
// V GitHub Actions se chyby vypíšou i jako anotace: ty jsou vidět bez přihlášení (logy ne).
const annotate = (message) => {
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=e2e::${message.split(/\s*\n\s*/).join(" ")}`);
};
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`);
  if (!ok) {
    failures.push(message);
    annotate(message);
  }
};

/**
 * Stránka v prohlížeči s daným jazykem (aplikace se podle něj přepne; bez něj by Playwright
 * převzal jazyk systému). Obrázky a API jsou podvržené.
 */
async function openPage(locale) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", locale });
  const page = await ctx.newPage();
  // CORS hlavička: 3D model balíčku načítá fotku obalu s crossOrigin (textura WebGL).
  const image = (body) => (r) =>
    r.fulfill({ contentType: "image/svg+xml", body, headers: { "Access-Control-Allow-Origin": "*" } });
  await page.route(/images\.(scrydex|pokemontcg)|assets\.tcgdex\.net/, image(CARD));
  await page.route(/tcgplayer-cdn/, image(PACK));
  await page.route(/tcg\.pokemon\.com/, image(BACK));
  await page.route(/api\.(pokemontcg\.io|tcgdex\.net)/, (r) => r.abort());
  return page;
}

/** Stránka, se kterou test právě pracuje (při pádu se z ní uloží snímek a adresa). */
let active = null;

try {
  // Hlavní průchod v češtině
  const page = await openPage("cs-CZ");
  active = page;
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const noHorizontalScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  // Obchod: sady podle éry, zavřená éra se vykreslí až po rozbalení
  await page.goto(url);
  await page.waitForSelector(".shop-tile");
  const eras = await page.locator(".era").count();
  check(eras >= 2, `obchod má sady rozdělené do ${eras} ér`);
  check((await page.locator(".era").first().locator(".shop-tile").count()) > 0, "nejnovější éra je otevřená");
  // pořadí první zavřené éry (lokátor „:not([open])“ by po rozbalení ukazoval jinam)
  const closedIndex = await page.locator(".era").evaluateAll((els) => els.findIndex((e) => !e.open));
  const closed = page.locator(".era").nth(closedIndex);
  check((await closed.locator(".shop-tile").count()) === 0, "zavřená éra se nevykresluje");
  await closed.locator("summary").click();
  // obsah se vytvoří v události toggle, ta přichází až po kliknutí
  await closed.locator(".shop-tile").first().waitFor({ timeout: 5000 }).catch(() => undefined);
  check((await closed.locator(".shop-tile").count()) > 0, "po rozbalení éry se ukážou její sady");
  check(await noHorizontalScroll(), "obchod nepřetéká do šířky");
  await page.screenshot({ path: join(SHOTS, "1-shop.png") });

  // Regál: výběr balíčku, regál se po obnovení nezmění
  await page.locator(".shop-tile").first().getByText("1 balíček").click();
  await page.waitForSelector(".shelf__slot");
  check((await page.locator(".shelf__slot").count()) === 10, "regál má 10 balíčků");
  const shelfOf = () =>
    page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("pokemon-packs:state:v1"));
      return Object.values(s.shelf)[0].map((p) => p.cards.map((c) => c.id).join(","));
    });
  const shelf = await shelfOf();
  await page.reload();
  await page.waitForSelector(".shelf__slot");
  check(JSON.stringify(await shelfOf()) === JSON.stringify(shelf), "regál po obnovení stránky zůstal stejný");
  check((await page.locator(".shelf__slot .packthumb").count()) === 10, "balíčky na regálu jsou lehké náhledy");
  await page.locator(".shelf__slot").nth(2).click();
  check((await page.locator(".shelf__slot.has-model .packgl canvas").count()) === 1, "vybraný balíček na regálu je 3D model");
  check(await noHorizontalScroll(), "regál s vybraným krajním balíčkem nepřetéká do šířky");
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, "2-shelf.png") });
  await page.getByText("Vzít a otevřít").click();

  // Otevření: 3D model (WebGL), roztržení klepnutím, karty jdou odhodit
  await page.waitForSelector(".packgl canvas, .pack3d--big");
  check((await page.locator(".packgl canvas").count()) === 1, "balíček je 3D model ve WebGL");
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SHOTS, "3a-pack.png") });
  // Roztržení tahem přes horní pruh (jako prstem): pruh se odlupuje, dotažením se balíček otevře.
  const box = await page.locator(".packgl").boundingBox();
  const tearY = box.y + box.height * 0.14;
  await page.mouse.move(box.x + box.width * 0.2, tearY);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width * (0.2 + i * 0.06), tearY);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, "3a2-tearing.png") });
  check((await page.locator(".pile").count()) === 0, "napůl roztržený balíček se ještě neotevře");
  for (let i = 7; i <= 14; i++) await page.mouse.move(box.x + box.width * (0.2 + i * 0.06), tearY);
  await page.mouse.up();
  await page.waitForSelector(".pile");
  check(true, "dotažený tah přes horní pruh balíček otevře");
  check((await page.locator(".pile__pack .packgl canvas").count()) === 1, "karty vyjíždějí z 3D obalu");
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOTS, "3b-rising.png") });
  // obal sjede dolů a zmizí
  await page.locator(".pile__pack").waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
  check((await page.locator(".pile__pack").count()) === 0, "obal po vytažení karet zmizí");
  const pile = await page.locator(".pile__item img.pcard__img").evaluateAll((els) =>
    els.map((e) => e.getAttribute("alt")),
  );
  check(pile.length > 0, `balíček obsahuje ${pile.length} karet`);
  await page.screenshot({ path: join(SHOTS, "3c-pile.png") });
  // Horní karta jde odtáhnout prstem do strany (pomalý tah přes polovinu šířky ji odhodí).
  const pileBox = await page.locator(".pile").boundingBox();
  const cx = pileBox.x + pileBox.width / 2;
  const cy = pileBox.y + pileBox.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(cx + (pileBox.width * 0.5 * i) / 10, cy);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(700);
  check((await page.locator(".stage__counter").textContent()).startsWith("2 /"), "horní kartu jde odhodit tahem");
  // zbytek klepnutím (každé odhodí horní kartu), po poslední se ukáže přehled
  for (let i = 0; i < 40 && !(await page.locator(".summary").count()); i++) {
    await page.locator(".pile").click({ force: true });
    await page.waitForTimeout(800);
  }
  check((await page.locator(".summary").count()) === 1, "po odhození všech karet se ukáže přehled");
  await page.screenshot({ path: join(SHOTS, "4-summary.png"), fullPage: true });

  // Album a 3D detail karty
  await page.goto(`${url}#/album`);
  await page.waitForSelector(".album-set");
  await page.locator(".album-set").first().click();
  await page.waitForSelector(".album-tile");
  await page.selectOption('select[aria-label="Zobrazit"]', "owned");
  check((await page.locator(".album-tile").count()) > 0, "album ukazuje získané karty");
  await page.locator(".album-tile").first().click();
  await page.waitForSelector(".modal .card3d");
  await page.getByRole("button", { name: "↻ Otočit" }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(SHOTS, "5-card3d.png") });
  await page.getByRole("button", { name: "⛶ Celá obrazovka" }).click();
  check((await page.locator(".viewer .card3d").count()) === 1, "3D prohlížeč jde otevřít přes celou obrazovku");
  await page.keyboard.press("Escape");
  check((await page.locator(".viewer").count()) === 0 && (await page.locator(".modal").count()) === 1, "Esc zavře jen celou obrazovku");
  // Zpět (Android) zavře jen okno, obrazovka zůstane
  const albumHash = await page.evaluate(() => location.hash);
  await page.getByRole("button", { name: "⛶ Celá obrazovka" }).click();
  await page.evaluate(() => history.back());
  await page.waitForTimeout(400);
  check((await page.locator(".viewer").count()) === 0 && (await page.locator(".modal").count()) === 1, "Zpět zavře celou obrazovku, detail karty zůstane");
  await page.evaluate(() => history.back());
  await page.waitForTimeout(400);
  check(
    (await page.locator(".modal").count()) === 0 && (await page.evaluate(() => location.hash)) === albumHash,
    "Zpět zavře detail karty a album zůstane otevřené",
  );
  await page.locator(".album-tile").first().click();
  await page.waitForSelector(".modal .card3d");
  let outside = 0;
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    if (!(await page.evaluate(() => !!document.activeElement?.closest(".modal")))) outside++;
  }
  check(outside === 0, "Tab zůstává uvnitř okna");

  // Statistiky: měřák štěstí a Síň slávy (detail karty se při přechodu sám zavře)
  await page.goto(`${url}#/stats`);
  await page.waitForSelector(".luck__verdict");
  await page.waitForTimeout(300);
  check((await page.locator(".modal").count()) === 0, "detail karty se při přechodu na jinou obrazovku zavře");
  check((await page.locator("h2", { hasText: "Měřák štěstí" }).count()) === 1, "statistiky ukazují měřák štěstí");
  check((await page.locator("h2", { hasText: "Síň slávy" }).count()) === 1, "statistiky ukazují Síň slávy");
  check(await noHorizontalScroll(), "statistiky nepřetékají do šířky");
  await page.screenshot({ path: join(SHOTS, "6-stats.png"), fullPage: true });

  // Síň slávy: god pack jde znovu „otevřít“, karty ani statistiky se nemění.
  // (God pack padá 1:500, proto se do Síně slávy vloží otevřený balíček označený jako god.)
  const progress = () =>
    page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("pokemon-packs:state:v1"));
      return JSON.stringify([s.collection, s.opened, s.packs, s.history.length]);
    });
  await page.evaluate(() => {
    const key = "pokemon-packs:state:v1";
    const s = JSON.parse(localStorage.getItem(key));
    const record = { ...s.history[0], god: true };
    // U 30th Celebration vždy i karta podsady Classic Collection (id me55c-…, soubor
    // me55c.json neexistuje): přehrávání ji dřív nenačetlo a padalo, když náhodou padla.
    if (record.setId === "me55") record.cards = [...record.cards.slice(0, -1), { id: "me55c-58", variant: "normal" }];
    s.hallOfFame.unshift(record);
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.reload();
  await page.waitForSelector(".hall__replay");
  check((await page.locator(".hall__pack").count()) === 1, "Síň slávy ukazuje god pack");
  // Seznam se po načtení cen překreslí: posun přímo na stránce, ať prvek neodpadne pod rukama.
  await page.evaluate(() => document.querySelector(".hall__pack")?.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: join(SHOTS, "6b-hall.png") });
  const before = await progress();
  await page.locator(".hall__replay").first().click();
  await page.waitForSelector(".packgl canvas, .pack3d--big");
  check((await page.getByText("Přehrávání").count()) > 0, "přehrávání god packu se otevře");
  // značka na plátně: po „Přehrát znovu“ má zůstat stejný model (žádný nový kontext WebGL)
  await page.locator(".packgl canvas").evaluate((c) => (c.dataset.e2e = "first"));
  await page.waitForTimeout(500);
  // klávesnice: Enter roztrhne balíček, Enter otáčí a odhazuje karty
  await page.keyboard.press("Enter");
  await page.waitForSelector(".pile");
  await page.waitForTimeout(900);
  for (let i = 0; i < 40 && !(await page.locator(".summary").count()); i++) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
  }
  check((await page.locator(".summary").count()) === 1, "přehrávání jde projít klávesnicí až do přehledu");
  check((await page.getByRole("button", { name: "▶ Přehrát znovu" }).count()) === 1, "přehled přehrávání nabízí Přehrát znovu");
  check((await progress()) === before, "přehrávání nepřidalo karty ani neubralo balíčky");
  await page.screenshot({ path: join(SHOTS, "7-replay.png"), fullPage: true });
  await page.getByRole("button", { name: "▶ Přehrát znovu" }).click();
  await page.waitForSelector(".packgl canvas");
  check((await page.locator('.packgl canvas[data-e2e="first"]').count()) === 1, "další balíček použije stejný 3D model");

  check(errors.length === 0, `bez chyb JavaScriptu${errors.length ? `: ${errors.join(" | ")}` : ""}`);

  // Angličtina: prohlížeč v angličtině dostane celou aplikaci anglicky (bez českých znaků),
  // ruční volba v sekci More přepne na češtinu.
  const enPage = await openPage("en-US");
  active = enPage;
  const enErrors = [];
  enPage.on("pageerror", (e) => enErrors.push(String(e)));
  const czechLeft = () =>
    enPage.evaluate(() =>
      // „Čeština“ ve výběru jazyka je název jazyka v jeho vlastním jazyce
      (document.body.innerText.match(/\S*[ěščřžůťďňĚŠČŘŽŮŤĎŇ]\S*/g) ?? []).filter((w) => w !== "Čeština").join(", "),
    );
  await enPage.goto(url);
  await enPage.waitForSelector(".shop-tile");
  check((await enPage.locator("h1").first().textContent()) === "Shop", "anglický prohlížeč: obchod je anglicky");
  check((await enPage.evaluate(() => document.documentElement.lang)) === "en", "anglický prohlížeč: jazyk stránky en");
  for (const route of ["#/shop", "#/open", "#/album", "#/stats", "#/more"]) {
    await enPage.goto(url + route);
    await enPage.waitForTimeout(600);
    const left = await czechLeft();
    check(left === "", "anglicky bez českých textů: " + route + (left ? " (" + left + ")" : ""));
  }
  await enPage.goto(url + "#/shop");
  await enPage.waitForSelector(".shop-tile");
  await enPage.screenshot({ path: join(SHOTS, "8-english-shop.png") });
  await enPage.getByRole("button", { name: "Odds & sources" }).first().click();
  await enPage.waitForSelector(".modal .odds");
  const oddsLeft = await czechLeft();
  check(oddsLeft === "", "anglicky bez českých textů: okno šancí" + (oddsLeft ? " (" + oddsLeft + ")" : ""));
  await enPage.waitForTimeout(400);
  await enPage.screenshot({ path: join(SHOTS, "9-english-odds.png") });
  await enPage.keyboard.press("Escape");
  await enPage.goto(url + "#/more");
  await enPage.waitForSelector('select[aria-label="Language"]');
  await Promise.all([enPage.waitForEvent("load"), enPage.selectOption('select[aria-label="Language"]', "cs")]);
  await enPage.waitForSelector("h1");
  check((await enPage.locator("h1").first().textContent()) === "Více", "ruční volba jazyka přepne na češtinu");
  check(enErrors.length === 0, "anglicky bez chyb JavaScriptu" + (enErrors.length ? ": " + enErrors.join(" | ") : ""));
} catch (err) {
  // nečekaná chyba (např. prvek se nedočkal): zapíše se jako selhání, ne jen do logu
  // první řádky chyby Playwrightu: co se dělo a na jaký prvek se čekalo; k tomu adresa
  // a začátek textu stránky (snímek je v e2e-shots/x-pad.png)
  let state = "";
  if (active) {
    await active.screenshot({ path: join(SHOTS, "x-pad.png") }).catch(() => undefined);
    const text = await active.evaluate(() => document.body.innerText.slice(0, 160)).catch(() => "");
    state = ` | adresa ${active.url()} | stránka: ${text.replace(/\s+/g, " ")}`;
  }
  const message = `test spadl: ${err instanceof Error ? err.message.split("\n").slice(0, 3).join(" ") : err}${state}`;
  console.log(`✗ ${message}`);
  failures.push(message);
  annotate(message);
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}

console.log(failures.length ? `\n${failures.length} kontrol selhalo` : `\nVše v pořádku, snímky v ${SHOTS}`);
process.exit(failures.length ? 1 : 0);
