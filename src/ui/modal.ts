import { h } from "./dom";

/**
 * Otevře modální okno; zavírá se tlačítkem, klikem mimo obsah, klávesou Esc
 * a při přechodu na jinou obrazovku (jinak by zůstalo viset přes ni).
 */
export function openModal(content: Node, extraClass = ""): () => void {
  const previous = document.activeElement as HTMLElement | null;
  const closeBtn = h("button", { class: "modal__close", "aria-label": "Zavřít" }, "×");
  const box = h("div", { class: `modal__box ${extraClass}`, role: "dialog", "aria-modal": "true" }, closeBtn, content);
  const overlay = h("div", { class: "modal" }, box);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.classList.add("modal--out");
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("hashchange", close);
    setTimeout(() => overlay.remove(), 180);
    previous?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => e.target === overlay && close());
  document.addEventListener("keydown", onKey);
  window.addEventListener("hashchange", close);
  document.body.append(overlay);
  closeBtn.focus();
  return close;
}
