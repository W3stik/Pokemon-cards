import type { SetInfo } from "../types";
import { h } from "../ui/dom";
import { packEl } from "../ui/pack";
import { unlockAudio } from "../ui/sfx";

/**
 * Záložní balíček z CSS vrstev (prohlížeč bez WebGL): tažení přes horní pruh ho
 * roztrhne, tažení jinde jím otáčí, prosté klepnutí ho otevře.
 */
export function cssPack(set: SetInfo, hintLvl: number, tear: () => void): HTMLElement {
  const pack = packEl(set, { large: true, tilt: true, hint: hintLvl });
  pack.classList.add("pack3d--big", "pack3d--idle");
  const cut = h("div", { class: "pack3d__cut" });
  pack.querySelector(".pack3d__body")!.append(cut);
  let drag: { x: number; mode: "tear" | "spin" } | null = null;
  let torn = false;
  const tearOnce = () => {
    if (torn) return;
    torn = true;
    pack.classList.remove("is-dragging");
    pack.style.setProperty("--spin", "0deg");
    tear();
  };
  pack.addEventListener("pointerdown", (e) => {
    unlockAudio();
    const r = pack.getBoundingClientRect();
    drag = { x: e.clientX, mode: e.clientY - r.top < r.height * 0.3 ? "tear" : "spin" };
    pack.classList.add("is-dragging");
    pack.setPointerCapture(e.pointerId);
  });
  pack.addEventListener("pointermove", (e) => {
    if (!drag || torn) return;
    const dx = e.clientX - drag.x;
    if (drag.mode === "spin") {
      pack.style.setProperty("--spin", `${dx * 0.9}deg`);
      return;
    }
    const progress = Math.min(1, Math.abs(dx) / (pack.getBoundingClientRect().width * 0.7));
    cut.style.setProperty("--cut", String(progress));
    if (progress >= 1) tearOnce();
  });
  const release = (e: PointerEvent) => {
    if (!drag) return;
    const moved = Math.abs(e.clientX - drag.x) > 8;
    drag = null;
    pack.classList.remove("is-dragging");
    if (torn) return;
    if (!moved) tearOnce();
    else {
      cut.style.setProperty("--cut", "0");
      pack.style.setProperty("--spin", "0deg");
    }
  };
  pack.addEventListener("pointerup", release);
  pack.addEventListener("pointercancel", release);
  return pack;
}
