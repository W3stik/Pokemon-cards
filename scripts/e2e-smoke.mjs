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
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`);
  if (!ok) failures.push(message);
};

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // CORS hlavička: 3D model balíčku načítá fotku obalu s crossOrigin (textura WebGL).
  const image = (body) => (r) =>
    r.fulfill({ contentType: "image/svg+xml", body, headers: { "Access-Control-Allow-Origin": "*" } });
  await page.route(/images\.(scrydex|pokemontcg)|assets\.tcgdex\.net/, image(CARD));
  await page.route(/tcgplayer-cdn/, image(PACK));
  await page.route(/tcg\.pokemon\.com/, image(BACK));
  await page.route(/api\.(pokemontcg\.io|tcgdex\.net)/, (r) => r.abort());

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
  await page.locator(".shelf__slot").nth(2).click();
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
  await page.waitForTimeout(900);
  const pile = await page.locator(".pile__item img.pcard__img").evaluateAll((els) =>
    els.map((e) => e.getAttribute("alt")),
  );
  check(pile.length > 0, `balíček obsahuje ${pile.length} karet`);
  await page.screenshot({ path: join(SHOTS, "3b-pile.png") });
  // Vzácné karty leží rubem nahoru: první klepnutí je otočí (nabití + otočení až ~1,7 s),
  // další je odhodí.
  let flipped = 0;
  for (let i = 0; i < 40 && !(await page.locator(".summary").count()); i++) {
    if (await page.locator(".pile__item.is-current.is-facedown").count()) flipped++;
    await page.locator(".pile").click({ force: true });
    await page.waitForTimeout(900);
  }
  if (flipped) check(true, `vzácné karty se otočily z rubu (${flipped}×)`);
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
    s.hallOfFame.unshift({ ...s.history[0], god: true });
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.reload();
  await page.waitForSelector(".hall__replay");
  check((await page.locator(".hall__pack").count()) === 1, "Síň slávy ukazuje god pack");
  await page.locator(".hall__pack").first().scrollIntoViewIfNeeded();
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
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}

console.log(failures.length ? `\n${failures.length} kontrol selhalo` : `\nVše v pořádku, snímky v ${SHOTS}`);
process.exit(failures.length ? 1 : 0);
