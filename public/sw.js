// Service worker: aplikace a data karet fungují i offline, obrázky karet
// se po prvním zobrazení ukládají do mezipaměti.

// Při buildu tento řádek nahradí vite.config.ts verzí a seznamem souborů aplikace.
const BUILD = { version: "dev", assets: [] };

const APP_CACHE = `app-${BUILD.version}`;
// Malé obrázky (karty v mřížce, obaly v obchodě) a zvlášť velké (detail karty,
// otevírání), které zabírají mnohem víc místa. Při nedostatku místa prohlížeč
// maže data webu vcelku, i se sbírkou, proto mají velké obrázky malý limit.
const IMG_CACHE = "card-images";
const IMG_LARGE_CACHE = "card-images-large";
const IMG_LIMIT = 2000;
// Velké WebP z TCGdex mají ~70 kB (dřívější PNG ~550 kB), proto jich může být víc.
const IMG_LARGE_LIMIT = 400;
const IMAGE_HOSTS = [
  "images.pokemontcg.io",
  "images.scrydex.com",
  "assets.tcgdex.net",
  "tcgplayer-cdn.tcgplayer.com",
  "tcg.pokemon.com",
];
const isLarge = (url) => /_hires\.|\/large$|\/high\.webp$|_in_1000x1000/.test(url);
// Oficiální rub karty: server nepovoluje CORS, proto se ukládá výjimečně i neprůhledný.
const CARD_BACK = "https://tcg.pokemon.com/assets/img/global/tcg-card-back-2x.jpg";
// Jak dlouho čekat na síť při spuštění aplikace, než se použije uložená verze.
const NAVIGATION_TIMEOUT = 3000;

const scope = new URL(self.registration.scope);
const local = (path) => new URL(path, scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      // Vždy ze sítě (cache: "reload"): z HTTP mezipaměti prohlížeče (GitHub Pages až 10 min)
      // by se mohla uložit stará stránka odkazující na soubory, které už na webu nejsou.
      const fresh = (path) => new Request(local(path), { cache: "reload" });
      await cache.addAll(
        ["./", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", ...BUILD.assets].map(fresh),
      );
      // Data všech sad, aby šlo otevírat balíčky i bez připojení.
      const res = await fetch(fresh("data/sets.json"));
      const sets = await res.clone().json();
      await cache.put(local("data/sets.json"), res);
      await cache.addAll(sets.map((s) => fresh(`data/${s.id}.json`)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Starší verze se mažou, ale předchozí zůstává: stránka otevřená ještě se starou verzí
      // (nebo právě načítaná) by jinak nenašla své soubory – GitHub Pages je při nasazení
      // smaže – a zůstala by prázdná. caches.keys() vrací mezipaměti v pořadí vytvoření.
      const keys = await caches.keys();
      const older = keys.filter((k) => k.startsWith("app-") && k !== APP_CACHE);
      await Promise.all(older.slice(0, -1).map((k) => caches.delete(k)));
      // Starší verze ukládaly velké obrázky mezi malé.
      const small = await caches.open(IMG_CACHE);
      for (const req of await small.keys()) if (isLarge(req.url)) await small.delete(req);
      await self.clients.claim();
    })(),
  );
});

// Promazání mezipaměti obrázků projde všechny položky (až tisíce), proto se nespouští po
// každém obrázku, ale jednou, až se pár sekund nic neukládá. Dřív to aplikaci po chvíli
// používání zpomalovalo: na výpis mezipaměti čekaly i obrázky, které v ní už byly.
const trimTimers = new Map();
function scheduleTrim(cacheName, limit) {
  clearTimeout(trimTimers.get(cacheName));
  trimTimers.set(
    cacheName,
    setTimeout(() => {
      trimTimers.delete(cacheName);
      trim(cacheName, limit);
    }, 5000),
  );
}

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const req of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(req);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  // Nejdřív aktuální verze, pak ostatní mezipaměti (předchozí verze, viz activate).
  const hit = (await cache.match(request.url)) ?? (await caches.match(request.url));
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request.url, res.clone());
  return res;
}

// Obrázky stahujeme v režimu CORS: neprůhledné (opaque) odpovědi by prohlížeč
// v kvótě úložiště počítal jako několik MB. Když server CORS nepovolí,
// obrázek se jen zobrazí a neuloží.
async function cacheImage(request) {
  const [cacheName, limit] = isLarge(request.url) ? [IMG_LARGE_CACHE, IMG_LARGE_LIMIT] : [IMG_CACHE, IMG_LIMIT];
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  try {
    let res;
    try {
      res = await fetch(request.url, { mode: "cors", credentials: "omit" });
    } catch {
      // HTTP mezipaměť prohlížeče může mít kopii z dřívějšího požadavku bez CORS (CDN
      // TCGplayeru pak neposílá Vary: Origin) a s ní CORS selže; čerstvá kopie ze sítě projde.
      res = await fetch(request.url, { mode: "cors", credentials: "omit", cache: "reload" });
    }
    if (res.ok) {
      await cache.put(request.url, res.clone());
      scheduleTrim(cacheName, limit);
    }
    return res;
  } catch {
    const res = await fetch(request);
    // Jediný neprůhledný obrázek (v kvótě se počítá víc, ale rub je v každém balíčku a offline chybí).
    if (request.url === CARD_BACK && res.type === "opaque") await cache.put(request.url, res.clone());
    return res;
  }
}

function updateCache(cache, request) {
  return fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
}

// Data sad a ceny: hned z mezipaměti, na pozadí se obnoví pro příští načtení.
// Dřív se při každém otevření sady čekalo na síť, na pomalém mobilním připojení i několik sekund.
async function staleWhileRevalidate(event) {
  const cache = await caches.open(APP_CACHE);
  const hit = await cache.match(event.request);
  const update = updateCache(cache, event.request);
  if (!hit) return update;
  event.waitUntil(update.catch(() => undefined));
  return hit;
}

// Stránka aplikace: přednostně ze sítě (kvůli nové verzi), ale nejdéle pár sekund,
// pak uložená verze. Síťová odpověď mezitím obnoví mezipaměť.
async function navigation(event) {
  const cache = await caches.open(APP_CACHE);
  // Stránka vždy ověřená u serveru, ne z HTTP mezipaměti prohlížeče (mohla by být stará).
  const network = fetch(event.request.url, { cache: "no-cache", credentials: "same-origin" }).then((res) => {
    // Přesměrovanou odpověď (adresa bez lomítka na konci) prohlížeč pro stránku nepřijme,
    // necháme ho přejít na cílovou adresu.
    if (res.redirected) return Response.redirect(res.url, 302);
    if (res.ok) cache.put(local("./"), res.clone());
    return res;
  });
  event.waitUntil(network.catch(() => undefined));
  const cached = (await cache.match(event.request)) ?? (await cache.match(local("./")));
  if (!cached) return network;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NAVIGATION_TIMEOUT));
  return Promise.race([network.catch(() => cached), timeout]);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (IMAGE_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheImage(request));
    return;
  }
  if (url.origin !== scope.origin) return;

  // Pozor: hodnota je "navigate" (dřív tu bylo "navigation", takže se stránka brala natvrdo
  // z mezipaměti a po nasazení mohla zůstat stará verze s odkazy na smazané soubory).
  if (request.mode === "navigate") {
    event.respondWith(navigation(event));
  } else if (url.pathname.includes("/data/")) {
    event.respondWith(staleWhileRevalidate(event));
  } else {
    // Soubory z buildu mají v názvu hash, takže se nemění.
    event.respondWith(cacheFirst(request, APP_CACHE));
  }
});
