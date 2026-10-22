import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Úložiště v paměti a podvržená konfigurace Supabase (testy nesmí na síť).
const storage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, String(v)),
  removeItem: (k: string) => void storage.delete(k),
  clear: () => storage.clear(),
  key: (i: number) => [...storage.keys()][i] ?? null,
  get length() {
    return storage.size;
  },
} as Storage;
vi.mock("./cloudConfig", () => ({
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  ACCOUNT_EMAIL_DOMAIN: "w3stik.github.io",
}));
// okno s volbou sbírky potřebuje prohlížeč; testuje se jen rozhodnutí
vi.mock("./ui/modal", () => ({ openModal: () => () => {} }));

let cloud: typeof import("./cloud");
let sync: typeof import("./sync");
let store: typeof import("./store");

beforeAll(async () => {
  cloud = await import("./cloud");
  store = await import("./store");
  sync = await import("./sync");
});

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;
const json = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body, statusText: "x" }) as unknown as Response;
const token = { access_token: "A1", refresh_token: "R1", expires_in: 3600, user: { id: "u-1" } };

beforeEach(async () => {
  fetchMock.mockReset();
  await cloud.signOut().catch(() => undefined);
  fetchMock.mockReset();
});

describe("účet jménem a heslem", () => {
  it("jméno: 3–20 znaků, malými písmeny, bez diakritiky a mezer", () => {
    expect(cloud.normalizeUsername("  Pepa_99 ")).toBe("pepa_99");
    expect(cloud.normalizeUsername("ab")).toBeNull();
    expect(cloud.normalizeUsername("Pepík")).toBeNull();
    expect(cloud.normalizeUsername("pepa novak")).toBeNull();
    expect(cloud.normalizeUsername("a".repeat(21))).toBeNull();
  });

  it("přihlášení pošle vymyšlený e-mail z jména a zapamatuje si přihlášení", async () => {
    fetchMock.mockResolvedValueOnce(json(200, token));
    await cloud.signIn("Pepa", "tajne123");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://test.supabase.co/auth/v1/token?grant_type=password");
    expect(JSON.parse(init.body)).toEqual({ email: "pepa@w3stik.github.io", password: "tajne123" });
    expect(init.headers.apikey).toBe("anon-key");
    expect(cloud.currentSession()).toMatchObject({ username: "pepa", userId: "u-1", accessToken: "A1" });
    expect(JSON.parse(storage.get("pokemon-packs:session")!).userId).toBe("u-1");
  });

  it("obsazené jméno a špatné heslo vrátí kód chyby", async () => {
    fetchMock.mockResolvedValueOnce(json(422, { code: 422, error_code: "user_already_exists", msg: "User already registered" }));
    await expect(cloud.signUp("pepa", "tajne123")).rejects.toMatchObject({ code: "user_already_exists" });
    fetchMock.mockResolvedValueOnce(json(400, { error: "invalid_grant", error_description: "Invalid login credentials" }));
    await expect(cloud.signIn("pepa", "spatne")).rejects.toMatchObject({ code: "invalid_grant" });
    expect(cloud.currentSession()).toBeNull();
  });

  it("bez tokenu po registraci = v Supabase je zapnuté potvrzování e-mailu", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: "u-1", email: "pepa@w3stik.github.io" }));
    await expect(cloud.signUp("pepa", "tajne123")).rejects.toMatchObject({ code: "confirm_email_enabled" });
  });

  it("změna hesla nejdřív ověří současné heslo, pak nastaví nové", async () => {
    fetchMock.mockResolvedValueOnce(json(200, token));
    await cloud.signIn("pepa", "stare123");
    fetchMock.mockResolvedValueOnce(json(200, { ...token, access_token: "A2" }));
    fetchMock.mockResolvedValueOnce(json(200, { id: "u-1" }));
    await cloud.changePassword("stare123", "nove1234");
    const [verifyUrl, verify] = fetchMock.mock.calls[1];
    expect(verifyUrl).toContain("grant_type=password");
    expect(JSON.parse(verify.body).password).toBe("stare123");
    const [updateUrl, update] = fetchMock.mock.calls[2];
    expect(updateUrl).toBe("https://test.supabase.co/auth/v1/user");
    expect(update.method).toBe("PUT");
    expect(update.headers.Authorization).toBe("Bearer A2");
    expect(JSON.parse(update.body)).toEqual({ password: "nove1234" });
  });

  it("uložení sbírky jde jako upsert vlastního záznamu", async () => {
    fetchMock.mockResolvedValueOnce(json(200, token));
    await cloud.signIn("pepa", "tajne123");
    fetchMock.mockResolvedValueOnce(json(201, null));
    await cloud.pushCollection({ packs: {} }, "2026-10-22T10:00:00.000Z");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://test.supabase.co/rest/v1/collections?on_conflict=user_id");
    expect(init.headers.Prefer).toContain("resolution=merge-duplicates");
    expect(JSON.parse(init.body)).toEqual({ user_id: "u-1", state: { packs: {} }, updated_at: "2026-10-22T10:00:00.000Z" });
  });

  it("bez připojení je chyba offline", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(cloud.signIn("pepa", "tajne123")).rejects.toMatchObject({ code: "offline" });
  });
});

describe("synchronizace po přihlášení", () => {
  const filled = () => {
    const s = store.sanitize({ version: 1, collection: {} });
    s.packs = { me1: 2 };
    return s;
  };

  it("prázdný cloud → nahrát, prázdný prohlížeč → stáhnout, stejné → nic, jiné → zeptat se", () => {
    const empty = store.sanitize({ version: 1, collection: {} });
    const a = filled();
    const b = { ...filled(), packs: { me2: 5 } };
    expect(sync.firstSyncAction(a, null)).toBe("upload");
    expect(sync.firstSyncAction(empty, a)).toBe("download");
    expect(sync.firstSyncAction(a, store.sanitize(JSON.parse(JSON.stringify(a))))).toBe("same");
    expect(sync.firstSyncAction(a, empty)).toBe("upload");
    expect(sync.firstSyncAction(a, b)).toBe("ask");
  });
});
