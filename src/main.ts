import "./styles/index.css";
import { lang, t } from "./i18n";
import { persistStorage, shouldRemindBackup } from "./storage";
import { stateSummary, storageFailed, subscribe, unopenedTotal } from "./store";
import { clear, h, toast } from "./ui/dom";
import { renderAlbum } from "./views/album";
import { renderOpen, renderReplay } from "./views/open";
import { renderPick } from "./views/pick";
import { renderSettings } from "./views/settings";
import { renderShop } from "./views/shop";
import { renderStats } from "./views/stats";
import { initSync } from "./sync";

const view = document.getElementById("view")!;
const packBadge = document.getElementById("pack-badge")!;

const routes: Record<string, (root: HTMLElement, arg?: string) => void | Promise<void>> = {
  shop: renderShop,
  open: renderOpen,
  album: renderAlbum,
  more: renderSettings,
  pick: renderPick,
  stats: renderStats,
  replay: renderReplay,
};

/** Podstránky, které v navigaci patří pod jinou záložku. */
const TAB_OF: Record<string, string> = { pick: "shop", stats: "album", replay: "album" };

let renderId = 0;

async function route() {
  const [name = "shop", arg] = location.hash.replace(/^#\/?/, "").split("/");
  const render = routes[name] ?? renderShop;
  const id = ++renderId;

  document.querySelectorAll<HTMLAnchorElement>(".tabbar a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === (routes[name] ? (TAB_OF[name] ?? name) : "shop"));
  });

  // Každá obrazovka se kreslí do nového kontejneru, aby pomalé načítání
  // předchozí obrazovky nepřepsalo tu aktuální.
  const root = h("div", { class: "view-root" });
  clear(view);
  view.append(root);
  window.scrollTo({ top: 0 });
  try {
    await render(root, arg);
  } catch (err) {
    if (id !== renderId) return;
    root.replaceChildren(
      h(
        "div",
        { class: "empty" },
        h("p", null, t.app.loadError),
        h("p", { class: "muted small" }, err instanceof Error ? err.message : String(err)),
        h("button", { class: "btn", onclick: () => route() }, t.app.retry),
      ),
    );
  }
}

function updateBadge() {
  const n = unopenedTotal();
  packBadge.textContent = n > 99 ? "99+" : String(n);
  packBadge.classList.toggle("hidden", n === 0);
}

/**
 * Jakmile má hráč první karty, požádáme o trvalé úložiště, aby prohlížeč
 * sbírku při nedostatku místa nesmazal. Bez něj jednou za čas připomeneme zálohu.
 */
let storageChecked = false;
async function protectCollection() {
  if (storageChecked || stateSummary().cards === 0) return;
  storageChecked = true;
  const persisted = await persistStorage();
  if (!persisted && stateSummary().cards >= 50 && (await shouldRemindBackup())) {
    toast(t.app.backupTip);
  }
}

/**
 * Uložení se nepovedlo (plné úložiště, anonymní okno): hra běží dál, ale po zavření
 * stránky by se nové karty ztratily – proto výrazné varování s cestou k záloze.
 * Zavřené varování se znovu ukáže, až se ukládání spraví a pak zase selže.
 */
let storageWarningClosed = false;
function checkStorage() {
  const shown = document.querySelector(".storage-banner");
  if (!storageFailed()) {
    shown?.remove();
    storageWarningClosed = false;
    return;
  }
  if (shown || storageWarningClosed) return;
  const banner = h(
    "div",
    { class: "update-banner storage-banner", role: "alert" },
    h("span", null, t.app.storageFailed),
    h("a", { class: "btn btn--primary", href: "#/more" }, t.app.backup),
    h(
      "button",
      {
        class: "btn btn--ghost",
        "aria-label": t.common.close,
        onclick: () => {
          storageWarningClosed = true;
          banner.remove();
        },
      },
      "×",
    ),
  );
  document.body.append(banner);
}

/** Nová verze aplikace převzala řízení: nabídneme obnovení stránky. */
function showUpdateBanner() {
  if (document.querySelector(".update-banner")) return;
  const banner = h(
    "div",
    { class: "update-banner", role: "status" },
    h("span", null, t.app.newVersion),
    h("button", { class: "btn btn--primary", onclick: () => location.reload() }, t.app.reload),
    h("button", { class: "btn btn--ghost", "aria-label": t.common.close, onclick: () => banner.remove() }, "×"),
  );
  document.body.append(banner);
}

// Zoom je zakázaný: viewport a touch-action: pan-x pan-y (blokuje i sevření dvěma prsty).
// Safari na iPhonu a sevření na touchpadu (posílá wheel s ctrlKey) to ignorují, proto je
// blokujeme i tady. Klávesové Ctrl + / Ctrl − na počítači necháváme, to je vědomá volba.
document.addEventListener("gesturestart", (e) => e.preventDefault());
window.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey) e.preventDefault();
  },
  { passive: false },
);

// Pevné texty z index.html v jazyce aplikace.
document.documentElement.lang = lang;
document.querySelector('meta[name="description"]')?.setAttribute("content", t.app.description);
document.querySelector(".tabbar")?.setAttribute("aria-label", t.app.nav);
const TAB_LABEL: Record<string, string> = {
  shop: t.app.tabs.shop,
  open: t.app.tabs.packs,
  album: t.app.tabs.album,
  more: t.app.tabs.more,
};
document.querySelectorAll<HTMLAnchorElement>(".tabbar a").forEach((a) => {
  const label = a.querySelector(".tabbar__label");
  if (label && TAB_LABEL[a.dataset.route ?? ""]) label.textContent = TAB_LABEL[a.dataset.route ?? ""];
});

initSync();
window.addEventListener("hashchange", route);
subscribe(updateBadge);
subscribe(protectCollection);
subscribe(checkStorage);
updateBadge();
protectCollection();
route();
// Aplikace naběhla: případné příští selhání načtení smí stránku zase jednou obnovit (index.html).
try {
  sessionStorage.removeItem("booster-lab:reloaded");
} catch {
  // nevadí
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    // Při úplně první instalaci service workeru nejde o novou verzi.
    let hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) showUpdateBanner();
      hadController = true;
    });
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Bez service workeru aplikace funguje dál, jen ne offline.
    });
  });
}
