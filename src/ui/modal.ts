import { t } from "../i18n";
import { h } from "./dom";
import { closeOnBack, trapFocus } from "./history";

/**
 * Otevře modální okno; zavírá se tlačítkem, klikem mimo obsah, klávesou Esc,
 * tlačítkem Zpět (zavře jen okno, ne obrazovku) a při přechodu na jinou obrazovku
 * (jinak by zůstalo viset přes ni). Tab přepíná jen mezi prvky okna.
 */
export function openModal(content: Node, extraClass = ""): () => void {
  const previous = document.activeElement as HTMLElement | null;
  const closeBtn = h("button", { class: "modal__close", "aria-label": t.common.close }, "×");
  const box = h("div", { class: `modal__box ${extraClass}`, role: "dialog", "aria-modal": "true" }, closeBtn, content);
  const overlay = h("div", { class: "modal" }, box);
  const focusTrap = trapFocus(box);

  let closed = false;
  const finish = () => {
    if (closed) return false;
    closed = true;
    overlay.classList.add("modal--out");
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("hashchange", close);
    setTimeout(() => overlay.remove(), 180);
    previous?.focus?.();
    return true;
  };
  // Zpět zavře okno samo; při jiném zavření se záznam z historie odebere.
  const releaseHistory = closeOnBack(finish);
  const close = () => {
    if (finish()) releaseHistory();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    else focusTrap(e);
  };

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => e.target === overlay && close());
  document.addEventListener("keydown", onKey);
  window.addEventListener("hashchange", close);
  document.body.append(overlay);
  closeBtn.focus();
  return close;
}
