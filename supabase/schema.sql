-- Booster Lab: tabulka pro sbírky hráčů v Supabase.
-- Vlož celé do Supabase → SQL Editor → New query → Run (jednou po založení projektu).

-- Jeden záznam na hráče: celá sbírka (stejná data jako záloha do souboru) a čas uložení.
create table if not exists public.collections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

-- Každý přihlášený vidí a mění jen svůj vlastní záznam (díky tomu smí být veřejný
-- klíč v aplikaci).
alter table public.collections enable row level security;

drop policy if exists "vlastni sbirka - cteni" on public.collections;
create policy "vlastni sbirka - cteni" on public.collections
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "vlastni sbirka - zalozeni" on public.collections;
create policy "vlastni sbirka - zalozeni" on public.collections
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "vlastni sbirka - zmena" on public.collections;
create policy "vlastni sbirka - zmena" on public.collections
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Smazání vlastního účtu z aplikace (tlačítko Smazat účet); sbírka se smaže s ním.
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
