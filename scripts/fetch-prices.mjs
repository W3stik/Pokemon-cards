// Stáhne aktuální tržní ceny všech karet z TCGdex (Cardmarket v EUR,
// TCGplayer v USD) a uloží je do public/data/prices.json, aby je aplikace
// měla hned a i offline. Spouští se v CI před buildem: npm run prices
import { readFile, writeFile } from "node:fs/promises";
import https from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTcgdexPricing } from "../src/tcgdexPricing.js";
import { API, CONCURRENCY, getJson, HEADERS, pairSet, pool } from "./tcgdex.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");

// TCGdex posílá dotazy podle polohy na různé servery (GeoDNS) a ty nemají vždy stejná data:
// 12. 10. 2026 americký server (kam míří runnery GitHub Actions) neměl ceny 30th Celebration,
// evropský ano. Karty bez ceny proto zkusíme ještě na serveru, který vidí klient z Evropy.
async function europeanAddress() {
  const host = new URL(API).hostname;
  const url = `https://dns.google/resolve?name=${host}&type=A&edns_client_subnet=185.0.0.0/16`;
  const answer = await getJson(url).catch(() => null);
  return answer?.Answer?.find((a) => a.type === 1)?.data ?? null;
}

// Vlastní spojení pro každou adresu: sdílený agent by znovu použil otevřené spojení
// na stejné jméno serveru, tedy na server z DNS, a adresa by se ignorovala.
const agents = new Map();
const agentFor = (address) => {
  if (!agents.has(address)) agents.set(address, new https.Agent({ keepAlive: true, maxSockets: CONCURRENCY }));
  return agents.get(address);
};

/** GET na konkrétní IP adresu (TLS i hlavička Host zůstávají pro původní jméno serveru). */
function getJsonVia(address, url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: HEADERS,
        agent: agentFor(address),
        timeout: 20000,
        lookup: (_host, opts, cb) => (opts.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4)),
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

const sets = JSON.parse(await readFile(join(DATA, "sets.json"), "utf8"));
const tcgdexSets = await getJson(`${API}/sets`);
const euAddress = await europeanAddress();
console.log(`Evropský server TCGdex: ${euAddress ?? "nezjištěn"}`);
const cards = {};
/** Statistika po sadách, uloží se i do prices.json (logy CI nejsou vždy po ruce). */
const stats = {};

for (const set of sets) {
  const all = JSON.parse(await readFile(join(DATA, `${set.id}.json`), "utf8"));
  const paired = await pairSet(set, all, tcgdexSets);
  if (!paired) continue;
  const { remote, pairs } = paired;

  const fetchCard = ([, c]) => getJson(`${API}/cards/${c.id}`);
  const details = await pool(pairs, fetchCard);
  // Neúspěšné požadavky ještě jednou, po jednom a s větší trpělivostí.
  for (let i = 0; i < pairs.length; i++) {
    if (!details[i]?.error) continue;
    await new Promise((r) => setTimeout(r, 1000));
    details[i] = await getJson(`${API}/cards/${pairs[i][1].id}`, 4).catch((err) => ({ error: err.message }));
  }

  // Karty bez ceny ještě jednou na evropském serveru.
  let fromEurope = 0;
  if (euAddress) {
    for (let i = 0; i < pairs.length; i++) {
      if (details[i]?.error || Object.keys(parseTcgdexPricing(details[i]?.pricing)).length) continue;
      const eu = await getJsonVia(euAddress, `${API}/cards/${pairs[i][1].id}`).catch(() => null);
      if (eu && Object.keys(parseTcgdexPricing(eu.pricing)).length) {
        details[i] = eu;
        fromEurope++;
      }
    }
  }

  const st = { cards: all.length, matched: pairs.length, priced: 0, fromEurope, noPricing: 0, failed: 0, error: undefined };
  pairs.forEach(([id], i) => {
    if (details[i]?.error) {
      st.failed++;
      st.error ??= details[i].error;
      return;
    }
    const price = parseTcgdexPricing(details[i]?.pricing);
    if (Object.keys(price).length) {
      cards[id] = price;
      st.priced++;
    } else st.noPricing++;
  });
  stats[set.id] = st;
  console.log(
    `${set.id.padEnd(10)} ${remote.id.padEnd(8)} ${st.priced}/${all.length} karet s cenou` +
      (st.fromEurope ? `, ${st.fromEurope} z evropského serveru` : "") +
      (st.noPricing ? `, ${st.noPricing} bez ceny v TCGdex` : "") +
      (st.failed ? `, ${st.failed} chyb (${st.error})` : ""),
  );
}

// Karty, které se tentokrát nepovedlo ocenit, doplní poslední známé ceny (v CI z nasazeného webu).
const fallbackUrl = process.env.PRICES_FALLBACK_URL;
if (fallbackUrl) {
  const previous = await getJson(fallbackUrl).catch(() => null);
  let filled = 0;
  for (const [id, price] of Object.entries(previous?.cards ?? {})) {
    if (cards[id]) continue;
    cards[id] = price;
    filled++;
  }
  console.log(previous ? `Doplněno ${filled} cen z minulého nasazení` : "Minulé ceny nejsou k dispozici");
}

const out = { updated: new Date().toISOString(), source: "tcgdex", stats, cards };
await writeFile(join(DATA, "prices.json"), JSON.stringify(out));
console.log(`Uloženo ${Object.keys(cards).length} cen do public/data/prices.json`);
for (const agent of agents.values()) agent.destroy();
