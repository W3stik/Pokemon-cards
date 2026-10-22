// Synchronizace sbírky s účtem: sbírka se dál ukládá v prohlížeči (funguje i offline),
// cloud je kopie navíc a most mezi zařízeními.
//  - po přihlášení: v cloudu nic → nahraje se sbírka z prohlížeče; prázdný prohlížeč
//    → stáhne se z cloudu; obě jiné → hráč vybere, kterou si nechat
//  - změny se odešlou pár vteřin po poslední (otevření balíčků jich udělá víc najednou)
//    a hned při odchodu z aplikace; bez připojení počkají
//  - při spuštění a návratu do aplikace se stáhne novější verze z jiného zařízení;
//    když se mezitím změnila i tady, hráč vybere
// Kterou verzi cloud má, se pozná podle času uložení (updated_at), jen porovnáním na shodu.
import { CloudError, cloudEnabled, currentSession, onSessionChange, pullCollection, pushCollection, type RemoteCollection } from "./cloud";
import { t } from "./i18n";
import { exportState, getState, type GameState, importState, sanitize, stateSummary, subscribe } from "./store";
import { h } from "./ui/dom";
import { openModal } from "./ui/modal";

export type SyncStatus = "off" | "syncing" | "ok" | "offline" | "error";

const META_KEY = "pokemon-packs:cloud-sync";
const PUSH_DELAY = 4000;

interface Meta {
  /** updated_at verze, kterou má cloud i tento prohlížeč. */
  syncedAt: string | null;
  /** Sbírka se tu od té doby změnila a ještě se neodeslala. */
  dirty: boolean;
}

function loadMeta(): Meta {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) ?? "null");
    return { syncedAt: typeof m?.syncedAt === "string" ? m.syncedAt : null, dirty: Boolean(m?.dirty) };
  } catch {
    return { syncedAt: null, dirty: false };
  }
}

let meta = loadMeta();
const saveMeta = () => {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // nevadí
  }
};

let status: SyncStatus = "off";
let lastSync: Date | null = null;
const listeners = new Set<() => void>();
export const syncStatus = () => ({ status, lastSync });
export function onSyncChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setStatus(next: SyncStatus) {
  status = next;
  if (next === "ok") lastSync = new Date();
  listeners.forEach((fn) => fn());
}

/** Co udělat po přihlášení (čistá funkce kvůli testům). */
export function firstSyncAction(local: GameState, remote: GameState | null): "upload" | "download" | "same" | "ask" {
  if (!remote) return "upload";
  if (JSON.stringify(local) === JSON.stringify(remote)) return "same";
  const l = stateSummary(local);
  if (l.cards + l.packs === 0) return "download";
  const r = stateSummary(remote);
  if (r.cards + r.packs === 0) return "upload";
  return "ask";
}

/** Hráč vybere, kterou sbírku si nechat (ze zařízení, nebo z účtu). */
function askWhich(local: GameState, remote: GameState): Promise<"local" | "remote"> {
  return new Promise((resolve) => {
    const l = stateSummary(local);
    const r = stateSummary(remote);
    let close = () => {};
    const pick = (choice: "local" | "remote") => {
      resolve(choice);
      close();
    };
    close = openModal(
      h(
        "div",
        null,
        h("h2", null, t.account.conflictTitle),
        h("p", { class: "muted" }, t.account.conflictText),
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn btn--primary", onclick: () => pick("remote") }, t.account.keepRemote(r.cards, r.packs)),
          h("button", { class: "btn", onclick: () => pick("local") }, t.account.keepLocal(l.cards, l.packs)),
        ),
      ),
    );
  });
}

let applying = false;
/** Převezme sbírku z cloudu (bez odeslání zpátky). */
function apply(remote: RemoteCollection, state: GameState) {
  applying = true;
  try {
    importState(state);
  } finally {
    applying = false;
  }
  meta = { syncedAt: remote.updatedAt, dirty: false };
  saveMeta();
}

const failed = (err: unknown) => setStatus(err instanceof CloudError && err.code === "offline" ? "offline" : "error");

let pushing: Promise<void> | null = null;
/** Odešle sbírku z prohlížeče do cloudu. */
async function push() {
  if (!currentSession()) return;
  if (pushing) return pushing;
  pushing = (async () => {
    setStatus("syncing");
    const updatedAt = new Date().toISOString();
    try {
      await pushCollection(JSON.parse(exportState()), updatedAt);
      meta = { syncedAt: updatedAt, dirty: false };
      saveMeta();
      setStatus("ok");
    } catch (err) {
      failed(err);
    } finally {
      pushing = null;
    }
  })();
  return pushing;
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, PUSH_DELAY);
}

/** Po přihlášení: srovná sbírku v prohlížeči a v cloudu. */
async function firstSync() {
  setStatus("syncing");
  try {
    const remote = await pullCollection();
    const remoteState = remote ? sanitize(remote.state) : null;
    const action = firstSyncAction(getState(), remoteState);
    if (action === "upload") return push();
    if (action === "same" || action === "download") {
      apply(remote!, remoteState!);
      return setStatus("ok");
    }
    const choice = await askWhich(getState(), remoteState!);
    if (choice === "remote") {
      apply(remote!, remoteState!);
      setStatus("ok");
    } else await push();
  } catch (err) {
    failed(err);
  }
}

/** Při spuštění a návratu do aplikace: převezme novější verzi z jiného zařízení. */
export async function syncNow() {
  if (!currentSession()) return;
  setStatus("syncing");
  try {
    const remote = await pullCollection();
    if (!remote || remote.updatedAt === meta.syncedAt) {
      // cloud se od posledně nezměnil: stačí odeslat, co se změnilo tady
      if (meta.dirty || !remote) return push();
      return setStatus("ok");
    }
    const remoteState = sanitize(remote.state);
    if (!meta.dirty || firstSyncAction(getState(), remoteState) === "same") {
      apply(remote, remoteState);
      return setStatus("ok");
    }
    // změnilo se na obou místech
    const choice = await askWhich(getState(), remoteState);
    if (choice === "remote") {
      apply(remote, remoteState);
      setStatus("ok");
    } else await push();
  } catch (err) {
    failed(err);
  }
}

/** Spustí synchronizaci (jednou při startu aplikace). */
export function initSync() {
  if (!cloudEnabled()) return;
  subscribe(() => {
    if (applying || !currentSession()) return;
    if (!meta.dirty) {
      meta.dirty = true;
      saveMeta();
    }
    schedulePush();
  });
  // reaguje jen na přihlášení jiného účtu / odhlášení (ne na obnovení tokenu či změnu hesla)
  let knownUser = currentSession()?.userId ?? null;
  onSessionChange((s) => {
    if ((s?.userId ?? null) === knownUser) return;
    knownUser = s?.userId ?? null;
    if (s) {
      // nový účet / jiný hráč: verze z cloudu se teprve zjistí
      meta = { syncedAt: null, dirty: meta.dirty };
      saveMeta();
      firstSync();
    } else {
      clearTimeout(pushTimer);
      meta = { syncedAt: null, dirty: false };
      saveMeta();
      setStatus("off");
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!currentSession()) return;
    if (document.hidden) {
      // odchod z aplikace: neodeslané změny hned
      if (meta.dirty) {
        clearTimeout(pushTimer);
        push();
      }
    } else syncNow();
  });
  window.addEventListener("online", () => {
    if (currentSession() && meta.dirty) push();
  });
  if (currentSession()) syncNow();
}
