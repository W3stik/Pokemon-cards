// Přihlašovací obrazovka: když je nastavený Supabase, bez účtu se do aplikace nejde.
// Po přihlášení main.ts sám vykreslí obrazovku podle adresy (reaguje na změnu účtu).
import { currentSession, signIn, signUp } from "../cloud";
import { t } from "../i18n";
import { h, toast } from "../ui/dom";
import { accountError, field } from "./account";

export function renderLogin(root: HTMLElement) {
  let mode: "in" | "up" = "in";
  const name = h("input", { type: "text", name: "username", autocomplete: "username", autocapitalize: "none", spellcheck: "false", maxlength: "20", required: "" });
  const password = h("input", { type: "password", name: "password", required: "" });
  const password2 = h("input", { type: "password", name: "password2", autocomplete: "new-password" });
  const again = field(t.login.password2, password2);
  const error = h("p", { class: "account__error", role: "alert" });
  const submit = h("button", { class: "btn btn--primary login__submit", type: "submit" });
  const tabIn = h("button", { type: "button", role: "tab" }, t.login.tabSignIn);
  const tabUp = h("button", { type: "button", role: "tab" }, t.login.tabSignUp);

  const setMode = (next: "in" | "up") => {
    mode = next;
    tabIn.setAttribute("aria-selected", String(mode === "in"));
    tabUp.setAttribute("aria-selected", String(mode === "up"));
    again.classList.toggle("hidden", mode === "in");
    password.autocomplete = mode === "in" ? "current-password" : "new-password";
    submit.textContent = mode === "in" ? t.account.signIn : t.account.signUp;
    error.textContent = "";
  };
  tabIn.addEventListener("click", () => setMode("in"));
  tabUp.addEventListener("click", () => setMode("up"));
  setMode("in");

  const form = h(
    "form",
    { class: "login__form", novalidate: "" },
    h("div", { class: "login__tabs", role: "tablist" }, tabIn, tabUp),
    h("div", { class: "account__fields" }, field(t.account.username, name), field(t.account.password, password), again),
    error,
    submit,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    if (mode === "up" && password.value !== password2.value) {
      error.textContent = t.account.mismatch;
      return;
    }
    submit.disabled = true;
    try {
      await (mode === "in" ? signIn : signUp)(name.value, password.value);
      toast(t.account.welcome(currentSession()?.username ?? ""));
    } catch (err) {
      error.textContent = accountError(err);
      submit.disabled = false;
    }
  });

  root.append(
    h(
      "section",
      { class: "login" },
      h("img", { class: "login__logo", src: "./icons/icon.svg", alt: "", width: "72", height: "72" }),
      h("h1", null, "Booster Lab"),
      h("p", { class: "muted" }, t.login.intro),
      form,
      h("p", { class: "muted small" }, t.login.nameRules, h("br"), t.login.forgotNote),
    ),
  );
  // na telefonu by klávesnice hned zakryla půl obrazovky
  if (matchMedia("(pointer: fine)").matches) name.focus();
}
