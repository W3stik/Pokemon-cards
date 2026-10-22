// Účty a uložení sbírky v Supabase, přímo přes jeho REST rozhraní (bez knihovny):
// přihlášení /auth/v1 (GoTrue), data /rest/v1 (PostgREST). Hráč má jen jméno a heslo,
// e-mail se z jména vyrobí (cloudConfig.ts). Přihlášení se pamatuje v localStorage
// a přístupový token se sám obnovuje.
import { ACCOUNT_EMAIL_DOMAIN, SUPABASE_ANON_KEY, SUPABASE_URL } from "./cloudConfig";

export const cloudEnabled = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Kdy přístupový token vyprší (sekundy od roku 1970). */
  expiresAt: number;
  userId: string;
  username: string;
}

/** Chyba ze Supabase s kódem (user_already_exists, invalid_credentials, weak_password, offline …). */
export class CloudError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const SESSION_KEY = "pokemon-packs:session";

/** Jméno: 3–20 znaků, písmena bez diakritiky, číslice, _ . - (velikost písmen nerozhoduje). */
export function normalizeUsername(name: string): string | null {
  const n = name.trim().toLowerCase();
  return /^[a-z0-9_.-]{3,20}$/.test(n) ? n : null;
}

export const usernameEmail = (username: string) => `${username}@${ACCOUNT_EMAIL_DOMAIN}`;

function loadSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    return s && typeof s.accessToken === "string" && typeof s.userId === "string" ? s : null;
  } catch {
    return null;
  }
}

let session: Session | null = loadSession();
const listeners = new Set<(s: Session | null) => void>();

export const currentSession = () => session;

export function onSessionChange(fn: (s: Session | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setSession(next: Session | null) {
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // nevadí – přihlášení platí do zavření stránky
  }
  listeners.forEach((fn) => fn(next));
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user: { id: string };
}

function sessionFrom(data: TokenResponse, username: string): Session {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at ?? Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
    userId: data.user.id,
    username,
  };
}

async function request<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.auth) headers.Authorization = `Bearer ${await accessToken()}`;
  let res: Response;
  try {
    res = await fetch(SUPABASE_URL + path, { ...init, headers });
  } catch {
    throw new CloudError("offline", "No connection");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const code = String(body.error_code ?? body.code ?? body.error ?? res.status);
    throw new CloudError(code, String(body.msg ?? body.message ?? body.error_description ?? res.statusText));
  }
  if (res.status === 204) return null as T;
  return (await res.json().catch(() => null)) as T;
}

/** Platný přístupový token; minutu před vypršením se obnoví. */
async function accessToken(): Promise<string> {
  if (!session) throw new CloudError("not_signed_in", "Not signed in");
  if (session.expiresAt - 60 > Date.now() / 1000) return session.accessToken;
  try {
    const data = await request<TokenResponse>("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    setSession(sessionFrom(data, session.username));
  } catch (err) {
    // obnovovací token neplatí (účet smazán, heslo změněno jinde): odhlásit
    if (err instanceof CloudError && err.code !== "offline") setSession(null);
    throw err;
  }
  return session!.accessToken;
}

function checkName(name: string): string {
  const username = normalizeUsername(name);
  if (!username) throw new CloudError("invalid_username", "Invalid username");
  return username;
}

/** Nový účet a rovnou přihlášení. */
export async function signUp(name: string, password: string) {
  const username = checkName(name);
  const data = await request<Partial<TokenResponse>>("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({ email: usernameEmail(username), password }),
  });
  // bez tokenu = v Supabase je zapnuté potvrzování e-mailu (na vymyšlenou adresu nic nedojde)
  if (!data?.access_token || !data.user) throw new CloudError("confirm_email_enabled", "Supabase requires email confirmation");
  setSession(sessionFrom(data as TokenResponse, username));
}

export async function signIn(name: string, password: string) {
  const username = checkName(name);
  const data = await request<TokenResponse>("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email: usernameEmail(username), password }),
  });
  setSession(sessionFrom(data, username));
}

/** Odhlášení (sbírka v prohlížeči zůstane). */
export async function signOut() {
  if (session) await request("/auth/v1/logout", { method: "POST", auth: true }).catch(() => undefined);
  setSession(null);
}

/** Změna hesla: současné se nejdřív ověří přihlášením, pak se nastaví nové. */
export async function changePassword(current: string, next: string) {
  if (!session) throw new CloudError("not_signed_in", "Not signed in");
  await signIn(session.username, current);
  await request("/auth/v1/user", { method: "PUT", auth: true, body: JSON.stringify({ password: next }) });
}

/** Smaže účet i sbírku v cloudu (SQL funkce delete_my_account), sbírka v prohlížeči zůstane. */
export async function deleteAccount() {
  await request("/rest/v1/rpc/delete_my_account", { method: "POST", auth: true, body: "{}" });
  setSession(null);
}

export interface RemoteCollection {
  state: unknown;
  updatedAt: string;
}

/** Sbírka uložená v cloudu, nebo null (zatím žádná). */
export async function pullCollection(): Promise<RemoteCollection | null> {
  const userId = session?.userId;
  if (!userId) throw new CloudError("not_signed_in", "Not signed in");
  const rows = await request<{ state: unknown; updated_at: string }[]>(
    `/rest/v1/collections?select=state,updated_at&user_id=eq.${encodeURIComponent(userId)}`,
    { auth: true },
  );
  return rows?.[0] ? { state: rows[0].state, updatedAt: rows[0].updated_at } : null;
}

/** Uloží sbírku do cloudu (založí nebo přepíše záznam hráče). */
export async function pushCollection(state: unknown, updatedAt: string) {
  const userId = session?.userId;
  if (!userId) throw new CloudError("not_signed_in", "Not signed in");
  await request("/rest/v1/collections?on_conflict=user_id", {
    method: "POST",
    auth: true,
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, state, updated_at: updatedAt }),
  });
}
