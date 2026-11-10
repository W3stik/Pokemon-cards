// Měření skeneru karet: „fotí“ náhodné karty z databáze skeneru (public/data/scan) se
// simulovanými vadami (posun, natočení, zkosení, rozmazání, jiné světlo, odlesk, šum) a
// počítá, kolikrát je aplikace pozná – stejným kódem a stejnou databází jako v telefonu.
// Slouží k ladění src/scan/*.ts. Nejdřív je potřeba databáze:  npm run scan-db
//
//   node scripts/scan-eval.mjs [počet snímků]
//
// Velké obrázky focených karet se stahují do .scan-cache (není v gitu).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { HEADERS, pool } from "./tcgdex.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".scan-cache");
const QUERIES = Number(process.argv[2] || 400);
await mkdir(join(CACHE, "img"), { recursive: true });

const index = JSON.parse(await readFile(join(ROOT, "public", "data", "scan", "index.json"), "utf8"));
const cards = index.sets.flatMap((set) => set.cards.map(([number, name]) => ({ id: `${set.id}-${number}`, name, image: `${set.base}/${number}` })));
console.log(`${index.sets.length} sad, ${cards.length} karet v databázi`);

const fileOf = (id, kind) => join(CACHE, "img", `${id.replace(/[^\w.-]/g, "_")}-${kind}.webp`);
async function download(card, kind) {
  const path = fileOf(card.id, kind);
  if (existsSync(path)) return;
  const res = await fetch(`${card.image}/${kind}.webp`, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
}
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const queries = Array.from({ length: QUERIES }, () => cards[Math.floor(rnd() * cards.length)]);
await pool(queries, (c) => download(c, "high"), 12);
const usable = cards;
const shots = queries.filter((c) => existsSync(fileOf(c.id, "high")));

// 3) prohlížeč: dekódování obrázků a stejný kód otisku jako v aplikaci (Vite ho přeloží)
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 5199 } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => console.log("  [page]", m.text()));
await page.route("**/scan-img/**", async (route) => {
  const [id, kind] = decodeURIComponent(route.request().url().split("/scan-img/")[1]).split("|");
  route.fulfill({ body: await readFile(fileOf(id, kind)), contentType: "image/webp" });
});
await page.goto(url + "src/scan/fingerprint.ts");

const TOP = 30;
const result = await page.evaluate(
  async ({ usable, shots, TOP }) => {
    const { identify, judge } = await import("/src/scan/match.ts");
    const { loadScanDb } = await import("/src/scan/db.ts");
    const load = async (id, kind) => createImageBitmap(await (await fetch(`/scan-img/${encodeURIComponent(id + "|" + kind)}`)).blob());
    // databáze tak, jak ji načítá aplikace (pořadí karet = pořadí v usable)
    const { db } = await loadScanDb();

    // simulace focení: karta v záběru 480×660, rámeček 360×503 uprostřed
    let seed = 777;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const span = (a, b) => a + (b - a) * rnd();
    const W = 480;
    const H = 660;
    const GW = 360;
    const GH = 503;
    const frame = new OffscreenCanvas(W, H);
    const ctx = frame.getContext("2d", { willReadFrequently: true });
    const LEVELS = {
      lehké: { shift: 0.015, scale: 0.02, rot: 1, shear: 0.01, blur: 0.6, light: 0.1, glare: 0.15, noise: 4 },
      běžné: { shift: 0.035, scale: 0.05, rot: 3, shear: 0.025, blur: 1.4, light: 0.22, glare: 0.4, noise: 8 },
      těžké: { shift: 0.06, scale: 0.08, rot: 6, shear: 0.05, blur: 2.4, light: 0.35, glare: 0.65, noise: 14 },
    };
    const shoot = (img, L) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = "none";
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `hsl(${span(0, 360)} ${span(5, 45)}% ${span(8, 60)}%)`;
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = `hsl(${span(0, 360)} ${span(5, 50)}% ${span(10, 70)}% / 0.5)`;
        ctx.fillRect(span(0, W), span(0, H), span(20, 200), span(20, 200));
      }
      const s = 1 + span(-L.scale, L.scale);
      ctx.translate(W / 2 + span(-L.shift, L.shift) * GW, H / 2 + span(-L.shift, L.shift) * GH);
      ctx.rotate((span(-L.rot, L.rot) * Math.PI) / 180);
      ctx.transform(1, span(-L.shear, L.shear), span(-L.shear, L.shear), 1, 0, 0);
      ctx.scale(s * (1 + span(-L.scale, L.scale) / 3), s);
      ctx.filter = `blur(${span(0, L.blur)}px) brightness(${1 + span(-L.light, L.light)}) contrast(${1 + span(-L.light, L.light)}) saturate(${1 + span(-L.light, L.light)})`;
      ctx.drawImage(img, -GW / 2, -GH / 2, GW, GH);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = "none";
      // barevný nádech světla a odlesk fólie
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = `hsl(${span(20, 220)} 60% ${span(100 - L.light * 60, 100)}%)`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "screen";
      const gx = span(60, W - 60);
      const gy = span(60, H - 60);
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, span(60, 220));
      g.addColorStop(0, `rgb(255 255 255 / ${span(0, L.glare)})`);
      g.addColorStop(1, "rgb(255 255 255 / 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      const d = ctx.getImageData(0, 0, W, H);
      for (let i = 0; i < d.data.length; i += 4) {
        const n = (rnd() - 0.5) * 2 * L.noise;
        d.data[i] += n;
        d.data[i + 1] += n;
        d.data[i + 2] += n;
      }
      ctx.putImageData(d, 0, 0);
      return d;
    };

    // tvar nalezeného umístění vůči rámečku: velikost, poměr stran, zkosení, posun středu
    const geom = ([cx, cy, ax, ay, bx, by]) => {
      const a = Math.hypot(ax, ay);
      const b = Math.hypot(bx, by);
      return {
        scale: Math.sqrt((a * b) / (GW * GH)),
        aspect: b / a / (GH / GW),
        skew: Math.abs(ax * bx + ay * by) / (a * b),
        offset: Math.hypot(cx - W / 2, cy - H / 2) / GW,
      };
    };

    const index = new Map(usable.map((c, i) => [c.id, i]));
    const sameName = (i, j) => usable[i].name === usable[j].name;
    const GUIDE = [W / 2, H / 2, GW, 0, 0, GH];
    const report = {};
    for (const [level, L] of Object.entries(LEVELS)) {
      const rows = [];
      let time = 0;
      for (const q of shots) {
        const img = await load(q.id, "high");
        const pixels = shoot(img, L);
        img.close();
        const truth = index.get(q.id);
        const t = performance.now();
        const found = identify({ rgba: pixels.data, w: W, h: H }, GUIDE, db, TOP);
        const { candidates, placement, sharpness } = found;
        time += performance.now() - t;
        const best = candidates[0];
        const other = candidates.find((c) => usable[c.index].name !== usable[best.index].name);
        rows.push({
          rank: candidates.findIndex((c) => c.index === truth),
          ok: best.index === truth,
          sameName: usable[best.index].name === q.name,
          score: best.score,
          other: other ? other.score : -1,
          truthScore: candidates.find((c) => c.index === truth)?.score ?? null,
          geom: { ...geom(placement), sharp: sharpness },
          verdict: judge(found, GUIDE, sameName),
          text: `${q.id} ${q.name} → ${usable[best.index].id} ${usable[best.index].name} (${best.score.toFixed(2)})`,
        });
      }
      report[level] = { rows, ms: time / shots.length };
    }
    // Záběry bez karty: stůl, zeď, šum, ruka, zvětšený kus potisku (cizí obrázek), rozostřená karta.
    const textures = [];
    for (const q of shots.slice(0, 12)) textures.push(await load(q.id, "high"));
    const SCENES = {
      "náhodné plochy": () => {
        ctx.fillStyle = `hsl(${span(0, 360)} ${span(5, 45)}% ${span(8, 60)}%)`;
        ctx.fillRect(0, 0, W, H);
        for (let i = 0; i < 10; i++) {
          ctx.fillStyle = `hsl(${span(0, 360)} ${span(5, 50)}% ${span(10, 70)}% / 0.6)`;
          ctx.fillRect(span(-100, W), span(-100, H), span(20, 300), span(20, 300));
        }
      },
      "zeď (přechod)": () => {
        const g = ctx.createLinearGradient(span(0, W), 0, span(0, W), H);
        g.addColorStop(0, `hsl(${span(0, 60)} 15% ${span(50, 85)}%)`);
        g.addColorStop(1, `hsl(${span(0, 60)} 15% ${span(30, 70)}%)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      },
      "dřevo (pruhy)": () => {
        ctx.fillStyle = `hsl(30 ${span(30, 50)}% ${span(25, 45)}%)`;
        ctx.fillRect(0, 0, W, H);
        const angle = span(-0.3, 0.3);
        for (let i = 0; i < 70; i++) {
          ctx.strokeStyle = `hsl(28 40% ${span(15, 55)}% / 0.5)`;
          ctx.lineWidth = span(1, 8);
          const y = span(-200, H + 200);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(W / 3, y + span(-30, 30) + angle * 100, (2 * W) / 3, y + span(-30, 30), W, y + angle * W);
          ctx.stroke();
        }
      },
      "šum": () => {
        const d = ctx.createImageData(W, H);
        const base = span(40, 200);
        for (let i = 0; i < d.data.length; i += 4) {
          const v = base + (rnd() - 0.5) * 120;
          d.data[i] = v;
          d.data[i + 1] = v * span(0.8, 1.2);
          d.data[i + 2] = v;
          d.data[i + 3] = 255;
        }
        ctx.putImageData(d, 0, 0);
        ctx.filter = `blur(${span(0, 3)}px)`;
        ctx.drawImage(frame, 0, 0);
        ctx.filter = "none";
      },
      "ruka / předmět": () => {
        ctx.fillStyle = `hsl(${span(0, 360)} 20% ${span(20, 50)}%)`;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = `hsl(${span(15, 30)} ${span(30, 50)}% ${span(45, 70)}%)`;
        ctx.beginPath();
        ctx.ellipse(span(100, W - 100), span(150, H - 150), span(80, 220), span(120, 300), span(0, 3), 0, Math.PI * 2);
        ctx.fill();
      },
      "zvětšený potisk": () => {
        const img = textures[Math.floor(rnd() * textures.length)];
        const k = span(2.5, 5);
        ctx.drawImage(img, -span(0, img.width * (k - 1)) , -span(0, img.height * (k - 1)), img.width * k, img.height * k);
      },
      "rozmazaná karta": () => {
        ctx.fillStyle = "#555";
        ctx.fillRect(0, 0, W, H);
        ctx.filter = "blur(14px)";
        ctx.drawImage(textures[Math.floor(rnd() * textures.length)], W / 2 - GW / 2, H / 2 - GH / 2, GW, GH);
        ctx.filter = "none";
      },
    };
    const empty = {};
    for (const [name, draw] of Object.entries(SCENES)) {
      const rows = [];
      for (let k = 0; k < 40; k++) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        ctx.filter = "none";
        draw();
        const pixels = ctx.getImageData(0, 0, W, H);
        const found = identify({ rgba: pixels.data, w: W, h: H }, GUIDE, db, TOP);
        const { candidates, placement, sharpness } = found;
        const best = candidates[0];
        const other = candidates.find((c) => usable[c.index].name !== usable[best.index].name);
        rows.push({ score: best.score, other: other ? other.score : -1, geom: { ...geom(placement), sharp: sharpness }, verdict: judge(found, GUIDE, sameName), text: `${usable[best.index].name} (${best.score.toFixed(2)})` });
      }
      empty[name] = rows;
    }
    textures.forEach((t) => t.close());
    return { report, empty };
  },
  { usable, shots, TOP },
);

const n = shots.length;
const pct = (k, of = n) => ((100 * k) / of).toFixed(1).padStart(5) + " %";
const q = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(2) : "–");
const fmtGeom = (rows) => {
  const g = (k, p) => q(rows.map((r) => r.geom[k]), p);
  return `velikost ${g("scale", 0.02)}–${g("scale", 0.98)}, poměr stran ${g("aspect", 0.02)}–${g("aspect", 0.98)}, zkosení do ${g("skew", 0.98)}, posun do ${g("offset", 0.98)}, ostrost ${g("sharp", 0.02)}–${g("sharp", 0.98)}`;
};
for (const [level, { rows, ms }] of Object.entries(result.report)) {
  console.log(`\n=== ${level}: ${n} snímků proti ${usable.length} kartám (${ms.toFixed(0)} ms na snímek)`);
  console.log(`pravá karta mezi kandidáty: ${pct(rows.filter((r) => r.rank >= 0).length)}`);
  const ok = rows.filter((r) => r.ok);
  const twin = rows.filter((r) => !r.ok && r.sameName);
  const wrong = rows.filter((r) => !r.ok && !r.sameName);
  console.log(`po přiložení: správně ${pct(ok.length)}, dotisk se stejným jménem ${pct(twin.length)}, jiná karta ${pct(wrong.length)}`);
  console.log(`skóre správných: 5 % ${q(ok.map((r) => r.score), 0.05)}, medián ${q(ok.map((r) => r.score), 0.5)} | nejlepší cizí karta: medián ${q(rows.map((r) => r.other), 0.5)}, 95 % ${q(rows.map((r) => r.other), 0.95)}, max ${q(rows.map((r) => r.other), 1)}`);
  // verdikt aplikace (RULES v src/scan/match.ts)
  const auto = rows.filter((r) => r.verdict === "sure");
  const maybe = rows.filter((r) => r.verdict === "maybe");
  const none = rows.filter((r) => r.verdict === "none");
  console.log(`  aplikace: samo přidá ${pct(auto.length)} (z toho špatná karta ${auto.filter((r) => !r.sameName).length}, dotisk ${auto.filter((r) => !r.ok && r.sameName).length}), nejisté ${pct(maybe.length)}, „není karta“ ${pct(none.length)}`);
  console.log(`  tvar umístění (2.–98. percentil): ${fmtGeom(ok)}`);
  if (wrong.length) console.log("  jiná karta:", wrong.slice(0, 6).map((r) => `${r.text} [pravá mezi kandidáty na ${r.rank}, skóre ${r.truthScore?.toFixed(2) ?? "–"}]`).join(" ; "));
  if (twin.length) console.log("  dotisky:", twin.slice(0, 4).map((r) => r.text).join(" ; "));
}
console.log(`\n=== záběry bez karty (po 40; aplikace smí říct jen „není karta“)`);
for (const [name, rows] of Object.entries(result.empty)) {
  const pass = rows.filter((r) => r.verdict === "sure");
  const maybe = rows.filter((r) => r.verdict === "maybe");
  console.log(
    `${name.padEnd(18)} skóre med ${q(rows.map((r) => r.score), 0.5)} max ${q(rows.map((r) => r.score), 1)} | odstup max ${q(rows.map((r) => r.score - r.other), 1)} | přidalo by ${pass.length}, nejisté ${maybe.length}${pass.length + maybe.length ? " (" + [...pass, ...maybe].slice(0, 3).map((r) => r.text).join(", ") + ")" : ""}`,
  );
  console.log(`   ${fmtGeom(rows)}`);
}
await browser.close();
await server.close();
