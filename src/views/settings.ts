import { lang, langPref, locale, setLangPref, t } from "../i18n";
import { isPersisted, lastBackup, markBackup } from "../storage";
import { exportState, importState, parseBackup, resetState, stateSummary } from "../store";
import { h, toast } from "../ui/dom";
import { CHARGE_MS, type Tier } from "../ui/reveal";
import { fxPrefs, setFxPrefs, sfxCharge, sfxFlip, sfxGodPack, sfxHit, sfxSwipe, sfxTear, unlockAudio } from "../ui/sfx";

const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

function fxToggle(key: "sound" | "vibrate", label: string, note?: string, onChange?: () => void) {
  const input = h("input", {
    type: "checkbox",
    checked: fxPrefs()[key],
    onchange: (e: Event) => {
      setFxPrefs({ [key]: (e.target as HTMLInputElement).checked });
      onChange?.();
      // Ukázka, jak to zní / jak to vibruje.
      if (fxPrefs()[key]) {
        unlockAudio();
        sfxHit(6);
      }
    },
  });
  return h("label", { class: "check" }, input, h("span", null, label, note ? h("small", { class: "muted" }, ` – ${note}`) : null));
}

function volumeSlider(): HTMLElement {
  const input = h("input", {
    type: "range",
    min: "0",
    max: "100",
    step: "5",
    value: String(Math.round(fxPrefs().volume * 100)),
    "aria-label": t.settings.volume,
  });
  input.addEventListener("input", () => setFxPrefs({ volume: Number(input.value) / 100 }));
  // po puštění posuvníku ukázka nové hlasitosti
  input.addEventListener("change", () => {
    unlockAudio();
    sfxHit(6);
  });
  return h("label", { class: "volume" }, h("span", null, t.settings.volume), input);
}

/** Ukázka odhalení vzácné karty: nabití, otočení a zvuk podle rarity (jako při otevírání). */
function previewRare(tier: Tier) {
  unlockAudio();
  const ms = CHARGE_MS[tier];
  sfxCharge(tier, ms);
  setTimeout(sfxFlip, ms);
  setTimeout(() => sfxHit(({ 0: 4, 1: 4, 2: 6, 3: 8, 4: 9 } as const)[tier]), ms + 300);
}

function soundPreview(): HTMLElement {
  const sample = (label: string, play: () => void) =>
    h("button", { class: "btn", onclick: () => (unlockAudio(), play()) }, label);
  return h(
    "div",
    null,
    h("p", { class: "muted small" }, t.settings.samples),
    h(
      "div",
      { class: "row" },
      sample(t.settings.sampleTear, sfxTear),
      sample(t.settings.sampleSwipe, () => sfxSwipe(Math.random() < 0.5 ? -1 : 1)),
      sample("RR", () => previewRare(1)),
      sample("IR / UR", () => previewRare(2)),
      sample("SIR", () => previewRare(3)),
      sample(t.settings.sampleGold, () => previewRare(4)),
      sample("God pack", sfxGodPack),
    ),
  );
}

/** Hlasitost a ukázky mají smysl jen se zapnutým zvukem: jinak jsou zašedlé a s vysvětlením. */
function soundControls(): { el: HTMLElement; sync: () => void } {
  const note = h("p", { class: "muted small" }, t.settings.soundIsOff);
  const el = h("div", null, volumeSlider(), soundPreview(), note);
  const sync = () => {
    const on = fxPrefs().sound;
    el.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach((c) => (c.disabled = !on));
    note.classList.toggle("hidden", on);
  };
  sync();
  return { el, sync };
}

/** Volba jazyka: podle zařízení, nebo natvrdo čeština / angličtina (změna obnoví stránku). */
function languageSelect(): HTMLElement {
  const select = h(
    "select",
    { "aria-label": t.settings.languageTitle },
    h("option", { value: "auto", selected: langPref === "auto" }, `${t.settings.languageAuto} (${lang === "cs" ? "Čeština" : "English"})`),
    h("option", { value: "cs", selected: langPref === "cs" }, "Čeština"),
    h("option", { value: "en", selected: langPref === "en" }, "English"),
  );
  select.addEventListener("change", () => setLangPref(select.value as "auto" | "cs" | "en"));
  return h("label", { class: "field" }, select);
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renderSettings(root: HTMLElement) {
  const sound = soundControls();
  const fileInput = h("input", {
    type: "file",
    accept: "application/json,.json",
    class: "hidden",
    onchange: async (e: Event) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      // Stejný soubor půjde vybrat znovu.
      input.value = "";
      if (!file) return;
      try {
        const backup = parseBackup(await file.text());
        const next = stateSummary(backup);
        const now = stateSummary();
        const question = t.settings.restoreConfirm(next.cards, next.packs, now.cards, now.packs);
        if (now.cards + now.packs > 0 && !confirm(question)) return;
        importState(backup);
        toast(t.settings.restored);
        refreshStatus();
      } catch (err) {
        toast(err instanceof Error ? err.message : t.settings.restoreFailed);
      }
    },
  });

  const status = h("p", { class: "muted small" });
  const refreshStatus = async () => {
    const at = lastBackup();
    const persisted = await isPersisted();
    status.textContent =
      t.settings.lastBackup(at ? dateFmt.format(at) : null) + (persisted ? t.settings.persisted : t.settings.notPersisted);
  };
  refreshStatus();

  root.append(
    h("section", { class: "view-head" }, h("h1", null, t.settings.title)),
    h(
      "section",
      { class: "panel" },
      h("h2", null, t.settings.backupTitle),
      h("p", { class: "muted" }, t.settings.backupIntro),
      h(
        "div",
        { class: "row" },
        h(
          "button",
          {
            class: "btn",
            onclick: () => {
              download(`booster-lab-${new Date().toISOString().slice(0, 10)}.json`, exportState());
              markBackup();
              refreshStatus();
            },
          },
          t.settings.download,
        ),
        h("button", { class: "btn", onclick: () => fileInput.click() }, t.settings.upload),
        fileInput,
        h(
          "button",
          {
            class: "btn btn--danger",
            onclick: () => {
              if (confirm(t.settings.resetConfirm)) {
                resetState();
                toast(t.settings.resetDone);
              }
            },
          },
          t.settings.reset,
        ),
      ),
      status,
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", null, t.settings.soundTitle),
      fxToggle("sound", t.settings.sound, undefined, sound.sync),
      sound.el,
      fxToggle("vibrate", t.settings.vibrate, "vibrate" in navigator ? undefined : t.settings.noVibrate),
    ),
    h("section", { class: "panel" }, h("h2", null, t.settings.languageTitle), languageSelect()),
    h(
      "section",
      { class: "panel" },
      h("h2", null, t.settings.dataTitle),
      h(
        "ul",
        { class: "plain" },
        h(
          "li",
          null,
          t.settings.dataCards,
          h("a", { href: "https://github.com/PokemonTCG/pokemon-tcg-data", target: "_blank", rel: "noopener" }, "PokemonTCG/pokemon-tcg-data"),
          t.settings.dataCardsNote,
        ),
        h(
          "li",
          null,
          t.settings.dataPrices,
          h("a", { href: "https://tcgdex.dev", target: "_blank", rel: "noopener" }, "TCGdex"),
          t.settings.dataPricesNote,
        ),
        h("li", null, t.settings.dataOdds),
      ),
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", null, t.settings.disclaimerTitle),
      h("p", { class: "muted" }, t.settings.disclaimer),
    ),
  );
}
