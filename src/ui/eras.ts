// Třídění sad podle éry (Mega Evolution, Scarlet & Violet, Sword & Shield …):
// rozbalovací sekce v obchodě, inventáři a albu.
import { h } from "./dom";

/** Seskupí položky podle éry; pořadí ér i položek zůstává (sady jsou od nejnovější). */
export function groupBySeries<T>(items: T[], seriesOf: (item: T) => string): { series: string; items: T[] }[] {
  const groups: { series: string; items: T[] }[] = [];
  for (const item of items) {
    const series = seriesOf(item);
    let group = groups.find((g) => g.series === series);
    if (!group) groups.push((group = { series, items: [] }));
    group.items.push(item);
  }
  return groups;
}

const storageKey = (view: string) => `pokemon-packs:eras:${view}`;

function loadOpen(view: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(storageKey(view)) ?? "{}");
  } catch {
    return {};
  }
}

function saveOpen(view: string, series: string, open: boolean) {
  try {
    const state = loadOpen(view);
    state[series] = open;
    localStorage.setItem(storageKey(view), JSON.stringify(state));
  } catch {
    // nevadí
  }
}

/**
 * Rozbalovací sekce éry. Obsah se vytvoří až při prvním otevření, aby se u zavřených
 * ér zbytečně nestahovaly fotky obalů a nekreslily 3D balíčky. Stav se pamatuje.
 */
export function eraSection(opts: {
  view: string;
  series: string;
  meta: string;
  defaultOpen: boolean;
  build: () => Node;
}): HTMLDetailsElement {
  const remembered = loadOpen(opts.view)[opts.series];
  const open = remembered ?? opts.defaultOpen;
  const body = h("div", { class: "era__body" });
  const section = h(
    "details",
    { class: "era", open },
    h("summary", { class: "era__summary" }, h("span", { class: "era__title" }, opts.series), h("span", { class: "era__meta muted" }, opts.meta)),
    body,
  );
  let built = false;
  const build = () => {
    if (built) return;
    built = true;
    body.append(opts.build());
  };
  if (open) build();
  section.addEventListener("toggle", () => {
    if (section.open) build();
    saveOpen(opts.view, opts.series, section.open);
  });
  return section;
}

