// Sekce Účet v nastavení: přihlášení jménem a heslem, nový účet, změna hesla,
// odhlášení a smazání účtu; stav synchronizace sbírky.
import { changePassword, CloudError, cloudEnabled, currentSession, deleteAccount, onSessionChange, signIn, signOut, signUp } from "../cloud";
import { locale, t } from "../i18n";
import { onSyncChange, syncNow, syncStatus } from "../sync";
import { h, toast } from "../ui/dom";

const timeFmt = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });

/** Chyba ze Supabase srozumitelně. */
function message(err: unknown): string {
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

const field = (label: string, input: HTMLInputElement) => h("label", { class: "field" }, h("span", null, label), input);

function signedOutView(error: HTMLElement): HTMLElement {
  const name = h("input", { type: "text", autocomplete: "username", autocapitalize: "none", spellcheck: "false", maxlength: "20" });
  const password = h("input", { type: "password", autocomplete: "current-password" });
  const run = (action: typeof signIn, button: HTMLButtonElement) => async () => {
    error.textContent = "";
    button.disabled = true;
    try {
      await action(name.value, password.value);
      toast(t.account.welcome(currentSession()?.username ?? ""));
    } catch (err) {
      error.textContent = message(err);
    } finally {
      button.disabled = false;
    }
  };
  const signInBtn = h("button", { class: "btn btn--primary" }, t.account.signIn);
  const signUpBtn = h("button", { class: "btn" }, t.account.signUp);
  signInBtn.addEventListener("click", run(signIn, signInBtn));
  signUpBtn.addEventListener("click", run(signUp, signUpBtn));
  password.addEventListener("keydown", (e) => e.key === "Enter" && signInBtn.click());
  return h(
    "div",
    { class: "account" },
    h("p", { class: "muted" }, t.account.intro),
    h("div", { class: "account__fields" }, field(t.account.username, name), field(t.account.password, password)),
    h("div", { class: "row" }, signInBtn, signUpBtn),
    error,
    h("p", { class: "muted small" }, t.account.nameRules, h("br"), t.account.forgotNote),
  );
}

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
      error.textContent = message(err);
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
          onclick: async () => {
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
            error.textContent = message(err);
          }
        },
      },
      t.account.deleteAccount,
    ),
  );
}

/** Sekce Účet; bez nastaveného Supabase se neukazuje (null). */
export function accountSection(): HTMLElement | null {
  if (!cloudEnabled()) return null;
  const section = h("section", { class: "panel" });
  const render = () => {
    const error = h("p", { class: "account__error", role: "alert" });
    section.replaceChildren(h("h2", null, t.account.title), currentSession() ? signedInView(error) : signedOutView(error));
  };
  render();
  // přihlášení / odhlášení přestaví sekci (obnovení tokenu ne)
  let user = currentSession()?.userId ?? null;
  const off = onSessionChange((s) => {
    if (!section.isConnected) return off();
    if ((s?.userId ?? null) === user) return;
    user = s?.userId ?? null;
    render();
  });
  return section;
}
