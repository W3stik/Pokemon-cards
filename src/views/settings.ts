import { isPersisted, lastBackup, markBackup } from "../storage";
import { exportState, importState, parseBackup, resetState, stateSummary } from "../store";
import { h, toast } from "../ui/dom";
import { CHARGE_MS, type Tier } from "../ui/reveal";
import { fxPrefs, setFxPrefs, sfxCharge, sfxFlip, sfxGodPack, sfxHit, sfxSwipe, sfxTear, unlockAudio } from "../ui/sfx";

const dateFmt = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium" });
const kusu = (n: number) => `${n} ${n === 1 ? "kus" : n >= 2 && n <= 4 ? "kusy" : "kusů"}`;

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
    "aria-label": "Hlasitost",
  });
  input.addEventListener("input", () => setFxPrefs({ volume: Number(input.value) / 100 }));
  // po puštění posuvníku ukázka nové hlasitosti
  input.addEventListener("change", () => {
    unlockAudio();
    sfxHit(6);
  });
  return h("label", { class: "volume" }, h("span", null, "Hlasitost"), input);
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
    h("p", { class: "muted small" }, "Ukázky zvuků:"),
    h(
      "div",
      { class: "row" },
      sample("Roztržení", sfxTear),
      sample("Odhození", () => sfxSwipe(Math.random() < 0.5 ? -1 : 1)),
      sample("RR", () => previewRare(1)),
      sample("IR / UR", () => previewRare(2)),
      sample("SIR", () => previewRare(3)),
      sample("Zlatá", () => previewRare(4)),
      sample("God pack", sfxGodPack),
    ),
  );
}

/** Hlasitost a ukázky mají smysl jen se zapnutým zvukem: jinak jsou zašedlé a s vysvětlením. */
function soundControls(): { el: HTMLElement; sync: () => void } {
  const note = h("p", { class: "muted small" }, "Zvuky jsou vypnuté – zapni je výše.");
  const el = h("div", null, volumeSlider(), soundPreview(), note);
  const sync = () => {
    const on = fxPrefs().sound;
    el.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach((c) => (c.disabled = !on));
    note.classList.toggle("hidden", on);
  };
  sync();
  return { el, sync };
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
        const question =
          `Záloha obsahuje ${kusu(next.cards)} karet a ${next.packs} neotevřených balíčků.
` +
          `Nahradit jí současnou sbírku (${kusu(now.cards)} karet, ${now.packs} balíčků)? Současná sbírka se ztratí.`;
        if (now.cards + now.packs > 0 && !confirm(question)) return;
        importState(backup);
        toast("Sbírka obnovena ze zálohy");
        refreshStatus();
      } catch (err) {
        toast(err instanceof Error ? err.message : "Zálohu se nepodařilo načíst");
      }
    },
  });

  const status = h("p", { class: "muted small" });
  const refreshStatus = async () => {
    const at = lastBackup();
    const persisted = await isPersisted();
    status.textContent =
      `Poslední záloha: ${at ? dateFmt.format(at) : "zatím žádná"}. ` +
      (persisted
        ? "Úložiště je trvalé, prohlížeč ho sám nesmaže."
        : "Úložiště není trvalé: při nedostatku místa ho prohlížeč může smazat, proto si sbírku zálohuj.");
  };
  refreshStatus();

  root.append(
    h("section", { class: "view-head" }, h("h1", null, "Více")),
    h(
      "section",
      { class: "panel" },
      h("h2", null, "Záloha sbírky"),
      h(
        "p",
        { class: "muted" },
        "Sbírka se ukládá jen v tomto prohlížeči. Zálohou ji přeneseš do jiného zařízení (např. z počítače do telefonu).",
      ),
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
          "Stáhnout zálohu",
        ),
        h("button", { class: "btn", onclick: () => fileInput.click() }, "Nahrát zálohu"),
        fileInput,
        h(
          "button",
          {
            class: "btn btn--danger",
            onclick: () => {
              if (confirm("Opravdu smazat celou sbírku a všechny neotevřené balíčky?")) {
                resetState();
                toast("Sbírka smazána");
              }
            },
          },
          "Smazat sbírku",
        ),
      ),
      status,
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", null, "Zvuky a vibrace"),
      fxToggle("sound", "Zvuky při otevírání balíčků", undefined, sound.sync),
      sound.el,
      fxToggle(
        "vibrate",
        "Vibrace při vzácné kartě",
        "vibrate" in navigator ? undefined : "toto zařízení nebo prohlížeč vibrace nepodporuje",
      ),
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", null, "Odkud jsou data"),
      h(
        "ul",
        { class: "plain" },
        h(
          "li",
          null,
          "Karty a sady: ",
          h("a", { href: "https://github.com/PokemonTCG/pokemon-tcg-data", target: "_blank", rel: "noopener" }, "PokemonTCG/pokemon-tcg-data"),
          " (stejná data jako Pokémon TCG API).",
        ),
        h(
          "li",
          null,
          "Ceny: ",
          h("a", { href: "https://tcgdex.dev", target: "_blank", rel: "noopener" }, "TCGdex"),
          " (Cardmarket v EUR a TCGplayer v USD), přibalené k aplikaci a obnovované každý den; detail karty zkouší i aktuální cenu z TCGdex.",
        ),
        h(
          "li",
          null,
          "Šance na tah: měření TCGplayer a komunitní statistiky. Přesné zdroje najdeš u každé sady v obchodě pod „Šance a zdroje“.",
        ),
      ),
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", null, "Upozornění"),
      h(
        "p",
        { class: "muted" },
        "Neoficiální fanouškovský projekt pro soukromé použití, bez reklam a bez prodeje. Pokémon, názvy karet a ilustrace patří společnostem Nintendo, Creatures, GAME FREAK a The Pokémon Company. Projekt s nimi nijak nesouvisí.",
      ),
    ),
  );
}
