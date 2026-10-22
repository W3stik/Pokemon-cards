// Sekce Účet v nastavení: změna hesla, odhlášení a smazání účtu; stav synchronizace
// sbírky. Přihlášení a nový účet jsou na přihlašovací obrazovce (login.ts).
import { changePassword, CloudError, cloudEnabled, currentSession, deleteAccount, signOut } from "../cloud";
import { locale, t } from "../i18n";
import { flushSync, onSyncChange, syncNow, syncStatus } from "../sync";
import { h, toast } from "../ui/dom";

const timeFmt = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });

/** Chyba ze Supabase srozumitelně. */
export function accountError(err: unknown): string {
  if (!(err instanceof CloudError)) return t.account.errOther(String(err));
  switch (err.code) {
    case "user_already_exists":
    case "email_exists":
      return t.account.errTaken;
    case "invalid_credentials":
    case "invalid_grant":
      return t.account.errWrong;
    case "weak_password":
      return t.account.errWeak;
    case "invalid_username":
      return t.account.errName;
    case "offline":
      return t.account.errOffline;
    case "confirm_email_enabled":
    case "email_address_invalid":
    case "email_not_confirmed":
      return t.account.errConfig;
    default:
      return t.account.errOther(err.message);
  }
}

export const field = (label: string, input: HTMLInputElement) => h("label", { class: "field" }, h("span", null, label), input);

function signedInView(error: HTMLElement): HTMLElement {
  const session = currentSession()!;
  const status = h("p", { class: "muted small" });
  const renderStatus = () => {
    const { status: s, lastSync } = syncStatus();
    status.textContent =
      s === "syncing"
        ? t.account.syncing
        : s === "offline"
          ? t.account.offline
          : s === "error"
            ? t.account.syncError
            : lastSync
              ? t.account.synced(timeFmt.format(lastSync))
              : "";
  };
  renderStatus();
  const off = onSyncChange(() => (status.isConnected ? renderStatus() : off()));

  // změna hesla (rozbalovací formulář)
  const current = h("input", { type: "password", autocomplete: "current-password" });
  const next = h("input", { type: "password", autocomplete: "new-password" });
  const next2 = h("input", { type: "password", autocomplete: "new-password" });
  const save = h("button", { class: "btn btn--primary" }, t.account.save);
  const form = h(
    "div",
    { class: "account__fields hidden" },
    field(t.account.currentPassword, current),
    field(t.account.newPassword, next),
    field(t.account.newPassword2, next2),
    h("div", { class: "row" }, save),
  );
  save.addEventListener("click", async () => {
    error.textContent = "";
    if (next.value !== next2.value) {
      error.textContent = t.account.mismatch;
      return;
    }
    save.disabled = true;
    try {
      await changePassword(current.value, next.value);
      current.value = next.value = next2.value = "";
      form.classList.add("hidden");
      toast(t.account.passwordChanged);
    } catch (err) {
      error.textContent = accountError(err);
    } finally {
      save.disabled = false;
    }
  });

  return h(
    "div",
    { class: "account" },
    h("p", null, h("strong", null, t.account.signedInAs(session.username))),
    status,
    h(
      "div",
      { class: "row" },
      h("button", { class: "btn", onclick: () => syncNow() }, t.account.syncNow),
      h("button", { class: "btn", onclick: () => form.classList.toggle("hidden") }, t.account.changePassword),
      h(
        "button",
        {
          class: "btn",
          onclick: async (e: Event) => {
            const button = e.currentTarget as HTMLButtonElement;
            button.disabled = true;
            // neodeslané změny nejdřív do cloudu; bez připojení zůstanou jen tady
            if (!(await flushSync()) && !confirm(t.account.unsyncedSignOut)) {
              button.disabled = false;
              return;
            }
            await signOut();
            toast(t.account.signedOut);
          },
        },
        t.account.signOut,
      ),
    ),
    form,
    error,
    h(
      "button",
      {
        class: "btn btn--danger account__delete",
        onclick: async () => {
          if (!confirm(t.account.deleteConfirm)) return;
          try {
            await deleteAccount();
            toast(t.account.deleted);
          } catch (err) {
            error.textContent = accountError(err);
          }
        },
      },
      t.account.deleteAccount,
    ),
  );
}

/** Sekce Účet; bez nastaveného Supabase nebo přihlášení se neukazuje (null). */
export function accountSection(): HTMLElement | null {
  if (!cloudEnabled() || !currentSession()) return null;
  const error = h("p", { class: "account__error", role: "alert" });
  return h("section", { class: "panel" }, h("h2", null, t.account.title), signedInView(error));
}
