// Supabase projekt pro účty a synchronizaci sbírky (viz supabase/schema.sql).
// Adresa a veřejný klíč (anon / publishable) smí být v kódu: k datům pustí jen pravidla
// v databázi (RLS – každý jen ke svému záznamu). Tajný klíč (service_role) sem nikdy.
// Prázdné hodnoty = účty se v aplikaci neukazují a vše funguje jen v prohlížeči.
export const SUPABASE_URL = "https://jgrbyjjcuqgmazlruxak.supabase.co/";
export const SUPABASE_ANON_KEY = "sb_publishable_oUO9_oVbVvcFQhrfBjaelw_WaAyI-hW";

/**
 * Supabase přihlašuje e-mailem; hráč zadává jen jméno a heslo, aplikace z jména vyrobí
 * adresu jmeno@ACCOUNT_EMAIL_DOMAIN (nikam se neposílá, v Supabase je vypnuté
 * „Confirm email“). Doména aplikace, aby adresa nepatřila nikomu cizímu.
 */
export const ACCOUNT_EMAIL_DOMAIN = "w3stik.github.io";
