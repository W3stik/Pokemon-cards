import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectLang } from "./i18n";
import { cs } from "./i18n/cs";
import { en } from "./i18n/en";

describe("jazyk", () => {
  it("čeština pro češtinu i slovenštinu, jinak angličtina", () => {
    expect(detectLang(["cs-CZ"])).toBe("cs");
    expect(detectLang(["sk"])).toBe("cs");
    expect(detectLang(["en-US", "cs"])).toBe("en");
    expect(detectLang(["de-DE", "cs-CZ"])).toBe("cs");
    expect(detectLang(["de-DE", "fr"])).toBe("en");
    expect(detectLang([])).toBe("en");
  });

  it("anglický slovník má stejné texty jako český", () => {
    const shape = (o: object): unknown =>
      Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === "object" ? shape(v) : typeof v]));
    expect(shape(en)).toEqual(shape(cs));
  });
});

/**
 * Obsah řetězců na řádku kódu (bez komentáře na konci řádku). Česká verze textu
 * v obou jazycích ({ cs: "…", en: "…" }) se přeskočí.
 */
function literals(line: string): string[] {
  const out: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) {
        if (!/\bcs:\s*$/.test(line.slice(0, start - 1))) out.push(line.slice(start, i));
        quote = null;
      }
    } else if (c === "/" && line[i + 1] === "/") break;
    else if (c === '"' || c === "'" || c === "`") {
      quote = c;
      start = i + 1;
    }
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".d.ts") ? [path] : [];
  });
}

describe("překlad", () => {
  it("v kódu nezůstal český text mimo slovník", () => {
    // Písmena, která má čeština a angličtina ne (é, á, í mají i jména karet jako Pokémon).
    const czech = /[ěščřžůťďňĚŠČŘŽŮŤĎŇ]/;
    const found: string[] = [];
    for (const file of sourceFiles(join(__dirname))) {
      if (file.endsWith(join("i18n", "cs.ts"))) continue;
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          const code = line.trim();
          // komentáře; texty v obou jazycích ({ cs: …, en: … }); název jazyka v jeho jazyce
          if (/^(\/\/|\*|\/\*)/.test(code) || /^cs:\s/.test(code) || code.includes('"Čeština"')) return;
          if (literals(line).some((s) => czech.test(s))) found.push(`${file.replace(__dirname, "src")}:${i + 1}: ${code}`);
        });
    }
    expect(found).toEqual([]);
  });
});
