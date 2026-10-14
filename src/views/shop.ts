import { loadSets } from "../data";
import { locale, t, tx } from "../i18n";
import { oddsTable, packProfile, packSize } from "../odds";
import { addPacks, getState } from "../store";
import type { SetInfo } from "../types";
import { h, toast } from "../ui/dom";
import { openModal } from "../ui/modal";
import { eraSection, groupBySeries } from "../ui/eras";
import { formatDate, packThumb } from "../ui/pack";

/** Hromadné balíčky se berou naslepo; jednotlivý balíček si hráč vybírá z regálu. */
const BULK = [
  { label: t.shop.tenPacks, count: 10 },
  { label: t.shop.boosterBox, count: 36 },
];

const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 });
const oneIn = (p: number) => (p >= 0.5 ? t.odds.almostEvery : `1 : ${Math.round(1 / p).toLocaleString(locale)}`);

export function showOdds(set: SetInfo) {
  const profile = packProfile(set.id);
  const rows = oddsTable(profile);
  const content = h(
    "div",
    { class: "odds" },
    h("h2", null, t.odds.title(set.name)),
    h("p", { class: "muted" }, t.odds.intro),
    h(
      "table",
      { class: "odds__table" },
      h("thead", null, h("tr", null, h("th", null, t.odds.rarity), h("th", null, t.odds.chance), h("th", null, t.odds.perPack))),
      h(
        "tbody",
        null,
        ...rows.map((r) => h("tr", null, h("td", null, r.label), h("td", null, oneIn(r.p)), h("td", null, pct.format(r.p)))),
      ),
    ),
    h("h3", null, t.odds.composition(packSize(profile))),
    h(
      "ol",
      { class: "odds__slots" },
      ...profile.slots.map((s) => h("li", null, s.count > 1 ? `${s.count}× ${s.label}` : s.label)),
    ),
    profile.note ? h("p", { class: "odds__note" }, tx(profile.note)) : null,
    profile.sources.length
      ? h(
          "div",
          { class: "odds__sources" },
          h("h3", null, t.odds.sources),
          h(
            "ul",
            null,
            ...profile.sources.map((s) => h("li", null, h("a", { href: s.url, target: "_blank", rel: "noopener" }, s.label))),
          ),
        )
      : null,
  );
  openModal(content, "modal__box--wide");
}

function setTile(set: SetInfo): HTMLElement {
  const owned = () => getState().packs[set.id] ?? 0;
  const ownedEl = h("span", { class: "chip" });
  const openBtn = h("a", { class: "btn btn--primary", href: `#/open/${set.id}` }, t.shop.open);
  const refresh = () => {
    ownedEl.textContent = t.common.unopened(owned());
    openBtn.classList.toggle("hidden", owned() === 0);
  };
  refresh();

  return h(
    "article",
    { class: "shop-tile" },
    h("div", { class: "shop-tile__pack" }, packThumb(set)),
    h(
      "div",
      { class: "shop-tile__body" },
      h("h2", null, set.name),
      h(
        "p",
        { class: "muted" },
        `${set.series} · ${formatDate(set.releaseDate)} · ${t.common.cards(set.total)}`,
      ),
      h(
        "div",
        { class: "shop-tile__buy" },
        h("a", { class: "btn", href: `#/pick/${set.id}` }, h("span", null, t.shop.onePack), h("small", null, t.shop.fromShelf)),
        ...BULK.map((p) =>
          h(
            "button",
            {
              class: "btn",
              onclick: () => {
                addPacks(set.id, p.count);
                refresh();
                toast(t.shop.added(p.count, set.name));
              },
            },
            h("span", null, p.label),
            h("small", null, t.common.free),
          ),
        ),
      ),
      h(
        "div",
        { class: "shop-tile__footer" },
        ownedEl,
        h("button", { class: "btn btn--ghost", onclick: () => showOdds(set) }, t.shop.odds),
        openBtn,
      ),
    ),
  );
}

export async function renderShop(root: HTMLElement) {
  const sets = await loadSets();
  const packs = getState().packs;
  root.append(
    h(
      "section",
      { class: "view-head" },
      h("h1", null, t.shop.title),
      h("p", { class: "muted" }, t.shop.intro),
    ),
    // Sady podle éry; otevřená je nejnovější, ostatní se rozbalí klepnutím.
    ...groupBySeries(sets, (s) => s.series).map(({ series, items }, i) => {
      const unopened = items.reduce((n, s) => n + (packs[s.id] ?? 0), 0);
      return eraSection({
        view: "shop",
        series,
        meta: t.common.sets(items.length) + (unopened ? t.shop.unopenedInEra(unopened) : ""),
        defaultOpen: i === 0,
        build: () => h("div", { class: "shop-grid" }, ...items.map(setTile)),
      });
    }),
  );
}
