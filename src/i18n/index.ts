// Jazyk aplikace: čeština (i pro slovenštinu) nebo angličtina podle jazyka zařízení;
// v sekci Více jde zvolit ručně. Texty jsou ve slovnících cs.ts a en.ts – anglický
// slovník má stejný typ jako český, takže TypeScript ohlídá, že žádný text nechybí.
//
// Jazyk se určí jednou při načtení stránky; změna v nastavení stránku obnoví.
import { cs, type Messages } from "./cs";
import { en } from "./en";

export type Lang = "cs" | "en";
export type LangPref = Lang | "auto";

const PREF_KEY = "pokemon-packs:lang";

/**
 * Jazyk podle seznamu jazyků zařízení (od nejoblíbenějšího): rozhoduje první čeština,
 * slovenština nebo angličtina v seznamu; když tam není ani jedna, angličtina.
 */
export function detectLang(languages: readonly string[]): Lang {
  for (const l of languages) {
    const code = l.toLowerCase().split(/[-_]/)[0];
    if (code === "cs" || code === "sk") return "cs";
    if (code === "en") return "en";
  }
  return "en";
}

function storedPref(): LangPref {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === "cs" || v === "en" ? v : "auto";
  } catch {
    return "auto";
  }
}

/** Jazyky zařízení; mimo prohlížeč (testy) čeština. */
function deviceLanguages(): readonly string[] {
  if (typeof navigator === "undefined" || typeof document === "undefined") return ["cs"];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

export const langPref: LangPref = storedPref();
export const lang: Lang = langPref === "auto" ? detectLang(deviceLanguages()) : langPref;
/** Formát dat, čísel a cen. Angličtina britská: datum den–měsíc–rok jako česky (14 Oct 2026). */
export const locale = lang === "cs" ? "cs-CZ" : "en-GB";
export const t: Messages = lang === "cs" ? cs : en;

/** Uloží volbu jazyka a obnoví stránku (texty se vytváří při načtení). */
export function setLangPref(pref: LangPref) {
  try {
    if (pref === "auto") localStorage.removeItem(PREF_KEY);
    else localStorage.setItem(PREF_KEY, pref);
  } catch {
    // nevadí – volba platí aspoň do obnovení
  }
  location.reload();
}

/** Text v obou jazycích u dat (poznámky k šancím v odds.ts). */
export interface Text {
  cs: string;
  en: string;
}
export const tx = (text: Text): string => text[lang];
