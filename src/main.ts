import "./styles.css";
import { persistStorage, shouldRemindBackup } from "./storage";
import { stateSummary, subscribe, unopenedTotal } from "./store";
import { clear, h, toast } from "./ui/dom";
import { renderAlbum } from "./views/album";
import { renderOpen } from "./views/open";
import { renderPick } from "./views/pick";
import { renderSettings } from "./views/settings";
import { renderShop } from "./views/shop";
import { renderStats } from "./views/stats";

const view = document.getElementById("view")!;
const packBadge = document.getElementById("pack-badge")!;

const routes: Record<string, (root: HTMLElement, arg?: string) => void | Promise<void>> = {
  shop: renderShop,
  open: renderOpen,
  album: renderAlbum,
  more: renderSettings,
  pick: renderPick,
  stats: renderStats,
};

/** Podstránky, které v navigaci patří pod jinou záložku. */
const TAB_OF: Record<string, string> = { pick: "shop", stats: "album" };

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
        h("p", null, "Něco se nepovedlo načíst."),
        h("p", { class: "muted small" }, err instanceof Error ? err.message : String(err)),
        h("button", { class: "btn", onclick: () => route() }, "Zkusit znovu"),
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
    toast("Tip: zálohuj si sbírku v sekci Více");
  }
}

/** Nová verze aplikace převzala řízení: nabídneme obnovení stránky. */
function showUpdateBanner() {
  if (document.querySelector(".update-banner")) return;
  const banner = h(
    "div",
    { class: "update-banner", role: "status" },
    h("span", null, "Je k dispozici nová verze aplikace."),
    h("button", { class: "btn btn--primary", onclick: () => location.reload() }, "Obnovit"),
    h("button", { class: "btn btn--ghost", "aria-label": "Zavřít", onclick: () => banner.remove() }, "×"),
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

window.addEventListener("hashchange", route);
subscribe(updateBadge);
subscribe(protectCollection);
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
