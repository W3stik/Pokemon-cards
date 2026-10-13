// Tlačítko Zpět (Android, prohlížeč) zavírá otevřená okna, ne celou obrazovku.
//
// Při otevření okna se do historie přidá záznam se stejnou adresou; Zpět ho odebere
// (popstate) a okno se zavře. Když se okno zavře jinak (×, Esc, klik vedle), záznam
// se z historie odebere, aby další Zpět fungovalo normálně.

interface Layer {
  id: string;
  close: () => void;
}

/** Otevřená okna od nejspodnějšího; každé má v historii vlastní záznam. */
const layers: Layer[] = [];
/** Kolik popstate vyvolalo naše vlastní history.back() (ty okna nezavírají). */
let ownBacks = 0;
let nextId = 1;

window.addEventListener("popstate", () => {
  if (ownBacks > 0) {
    ownBacks--;
    return;
  }
  // Zavřou se všechna okna nad tím, jehož záznam je teď aktuální (Zpět jich mohlo sundat víc).
  const current = history.state?.boosterLayer;
  while (layers.length && layers[layers.length - 1].id !== current) layers.pop()!.close();
});

/**
 * Zaregistruje okno do historie. `close` se zavolá při Zpět; vrácená funkce se volá
 * při zavření okna jinak (odebere záznam z historie).
 */
export function closeOnBack(close: () => void): () => void {
  // timeOrigin odliší záznamy z dřívějšího načtení stránky (po obnovení s otevřeným oknem)
  const layer: Layer = { id: `${performance.timeOrigin}-${nextId++}`, close };
  layers.push(layer);
  history.pushState({ ...(history.state ?? {}), boosterLayer: layer.id }, "");
  return () => {
    const i = layers.indexOf(layer);
    if (i < 0) return;
    layers.splice(i, 1);
    if (history.state?.boosterLayer === layer.id) {
      ownBacks++;
      history.back();
    }
  };
}

/** Drží fokus klávesnice (Tab / Shift+Tab) uvnitř okna. */
export function trapFocus(container: HTMLElement): (e: KeyboardEvent) => void {
  return (e) => {
    if (e.key !== "Tab") return;
    const focusable = [
      ...container.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])"),
    ].filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (!container.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
  };
}
