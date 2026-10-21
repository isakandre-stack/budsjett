-- Budsjett: fase 1
-- Kjøres i et eget Supabase-prosjekt, aldri i Dialr sitt.
-- Alle beløp lagres som heltall i øre (bigint). Ingen flyttall.

-- ============================================================
-- Typer
-- ============================================================

-- expense        utgift (forbruk)
-- income         inntekt
-- transfer       overføring mellom egne kontoer (aldri inntekt eller forbruk)
-- saving         sparing/investering (penger ut av forbruket, ikke forbruk)
-- loan_drawdown  låneopptak (likviditet inn, ikke inntekt)
-- loan_principal avdrag på gjeld (likviditet ut, ikke forbruk)
-- interest_fee   renter og gebyrer (forbruk)
-- refund         refusjon/tilbakebetaling (reduserer forbruk)
create type public.tx_kind as enum (
  'expense', 'income', 'transfer', 'saving',
  'loan_drawdown', 'loan_principal', 'interest_fee', 'refund'
);
create type public.tx_visibility as enum ('private', 'shared');
create type public.member_role as enum ('owner', 'member');
create type public.category_kind as enum ('expense', 'income');
create type public.account_type as enum (
  'checking', 'savings', 'credit_card', 'cash', 'loan', 'investment', 'other'
);

-- ============================================================
-- Tabeller
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  currency char(3) not null default 'NOK',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  type public.account_type not null default 'checking',
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (household_id, name),
  unique (id, household_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  parent_id uuid,
  kind public.category_kind not null default 'expense',
  name text not null check (char_length(name) between 1 and 60),
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  unique nulls not distinct (household_id, parent_id, name),
  check (parent_id is null or parent_id <> id),
  foreign key (parent_id, household_id)
    references public.categories (id, household_id) on delete cascade
);
create index categories_household_idx on public.categories (household_id);

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  normalized_name text generated always as
    (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) stored,
  default_category_id uuid,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, normalized_name),
  foreign key (default_category_id, household_id)
    references public.categories (id, household_id) on delete set null (default_category_id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind public.tx_kind not null,
  amount_ore bigint not null check (amount_ore > 0 and amount_ore < 100000000000),
  occurred_on date not null,
  occurred_time time,
  merchant_id uuid,
  category_id uuid,
  account_id uuid,
  to_account_id uuid,
  description text check (char_length(description) <= 200),
  note text check (char_length(note) <= 2000),
  tags text[] not null default '{}',
  visibility public.tx_visibility not null default 'private',
  refund_of_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  check (to_account_id is null or kind = 'transfer'),
  check (to_account_id is null or account_id is null or to_account_id <> account_id),
  check (refund_of_id is null or kind = 'refund'),
  check (refund_of_id is null or refund_of_id <> id),
  -- Sammensatte fremmednøkler: alt en transaksjon peker på må tilhøre samme husholdning.
  foreign key (merchant_id, household_id)
    references public.merchants (id, household_id) on delete set null (merchant_id),
  foreign key (category_id, household_id)
    references public.categories (id, household_id) on delete set null (category_id),
  foreign key (account_id, household_id)
    references public.financial_accounts (id, household_id) on delete set null (account_id),
  foreign key (to_account_id, household_id)
    references public.financial_accounts (id, household_id) on delete set null (to_account_id),
  foreign key (refund_of_id, household_id)
    references public.transactions (id, household_id) on delete set null (refund_of_id)
);
create index transactions_household_date_idx on public.transactions (household_id, occurred_on desc, created_at desc);
create index transactions_category_idx on public.transactions (category_id);
create index transactions_merchant_idx on public.transactions (merchant_id);
create index transactions_created_by_idx on public.transactions (created_by);

-- Splitting av én transaksjon på flere kategorier.
-- Summen av splittene må alltid være lik transaksjonens beløp.
create table public.transaction_splits (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null,
  household_id uuid not null,
  category_id uuid,
  amount_ore bigint not null check (amount_ore > 0),
  note text check (char_length(note) <= 200),
  foreign key (transaction_id, household_id)
    references public.transactions (id, household_id) on delete cascade,
  foreign key (category_id, household_id)
    references public.categories (id, household_id) on delete set null (category_id)
);
create index transaction_splits_tx_idx on public.transaction_splits (transaction_id);

create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  default_household_id uuid references public.households (id) on delete set null,
  default_account_id uuid references public.financial_accounts (id) on delete set null,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Hjelpefunksjoner for tilgang
-- ============================================================

create function public.is_member(hid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = auth.uid()
  );
$$;

-- Krever at økten er verifisert med tofaktor (aal2).
-- Uten dette får ingen lese eller skrive økonomidata, selv med riktig passord.
create function public.mfa_ok()
returns boolean
language sql stable set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

-- ============================================================
-- Triggere
-- ============================================================

create function public.tx_before_write()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.created_by <> old.created_by or new.household_id <> old.household_id then
      raise exception 'created_by og household_id kan ikke endres';
    end if;
    new.updated_at := now();
  end if;
  if new.kind <> 'transfer' then
    new.to_account_id := null;
  end if;
  return new;
end;
$$;

create trigger transactions_before_write
before insert or update on public.transactions
for each row execute function public.tx_before_write();

-- Husker siste kategori per butikk, brukt til kategoriforslag.
create function public.tx_learn_merchant()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.merchant_id is not null and new.category_id is not null then
    update public.merchants
       set default_category_id = new.category_id,
           use_count = use_count + case when tg_op = 'INSERT' then 1 else 0 end,
           last_used_at = now()
     where id = new.merchant_id;
  end if;
  return null;
end;
$$;

create trigger transactions_learn_merchant
after insert or update of merchant_id, category_id on public.transactions
for each row execute function public.tx_learn_merchant();

-- Splittsum må stemme. Sjekkes ved slutten av transaksjonen (deferred),
-- slik at man kan erstatte alle splitt i én operasjon.
create function public.check_split_sum()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  tx_id uuid;
  tx_amount bigint;
  split_sum bigint;
  split_count integer;
begin
  if tg_table_name = 'transactions' then
    tx_id := coalesce(new.id, old.id);
  else
    tx_id := coalesce(new.transaction_id, old.transaction_id);
  end if;

  select amount_ore into tx_amount from public.transactions where id = tx_id;
  if tx_amount is null then
    return null; -- transaksjonen er slettet
  end if;

  select coalesce(sum(amount_ore), 0), count(*) into split_sum, split_count
    from public.transaction_splits where transaction_id = tx_id;

  if split_count > 0 and split_sum <> tx_amount then
    raise exception 'Splittene (% øre) summerer ikke til transaksjonens beløp (% øre)', split_sum, tx_amount
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger transaction_splits_sum
after insert or update or delete on public.transaction_splits
deferrable initially deferred
for each row execute function public.check_split_sum();

create constraint trigger transactions_split_sum
after update of amount_ore on public.transactions
deferrable initially deferred
for each row execute function public.check_split_sum();

-- Kategori må tilhøre samme husholdning som forelderen, og bare to nivåer.
create function public.category_before_write()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  parent_parent uuid;
  parent_kind public.category_kind;
begin
  if new.parent_id is not null then
    select parent_id, kind into parent_parent, parent_kind
      from public.categories where id = new.parent_id;
    if parent_parent is not null then
      raise exception 'Kategorier kan bare ha ett nivå med underkategorier';
    end if;
    new.kind := parent_kind;
  end if;
  return new;
end;
$$;

create trigger categories_before_write
before insert or update on public.categories
for each row execute function public.category_before_write();

-- ============================================================
-- Oppstart for ny bruker: profil, husholdning, konto og kategorier
-- ============================================================

create function public.seed_household(hid uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  parent uuid;
  cat record;
  sub text;
  i integer := 0;
begin
  for cat in
    select * from (values
      ('Bolig', 'expense', '#6366f1', array['Husleie og boliglån', 'Strøm', 'Felleskostnader', 'Vedlikehold']),
      ('Mat og dagligvarer', 'expense', '#22c55e', array['Dagligvarer', 'Kiosk og bensinstasjon']),
      ('Restaurant og kafé', 'expense', '#f97316', array['Restaurant', 'Kafé', 'Takeaway']),
      ('Transport og bil', 'expense', '#0ea5e9', array['Kollektiv', 'Drivstoff og lading', 'Parkering og bom', 'Bilhold']),
      ('Shopping', 'expense', '#ec4899', array['Klær', 'Elektronikk', 'Hjem og interiør']),
      ('Helse og trening', 'expense', '#14b8a6', array['Trening', 'Lege og apotek']),
      ('Underholdning', 'expense', '#a855f7', array['Konsert og arrangement', 'Spill og hobby']),
      ('Abonnementer', 'expense', '#eab308', array['Strømmetjenester', 'Mobil og internett', 'Programvare']),
      ('Reise og ferie', 'expense', '#06b6d4', array['Fly og tog', 'Overnatting']),
      ('Forsikring', 'expense', '#64748b', array[]::text[]),
      ('Gaver', 'expense', '#f43f5e', array[]::text[]),
      ('Sparing og investering', 'expense', '#10b981', array[]::text[]),
      ('Renter og gebyrer', 'expense', '#78716c', array[]::text[]),
      ('Diverse', 'expense', '#94a3b8', array[]::text[]),
      ('Lønn', 'income', '#16a34a', array[]::text[]),
      ('Andre inntekter', 'income', '#65a30d', array[]::text[])
    ) as t(name, kind, color, subs)
  loop
    i := i + 1;
    insert into public.categories (household_id, name, kind, color, sort_order)
    values (hid, cat.name, cat.kind::public.category_kind, cat.color, i * 10)
    returning id into parent;

    foreach sub in array cat.subs loop
      insert into public.categories (household_id, parent_id, name, kind, color, sort_order)
      values (hid, parent, sub, cat.kind::public.category_kind, cat.color, 0);
    end loop;
  end loop;
end;
$$;

create function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  hid uuid;
  aid uuid;
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(coalesce(new.email, ''), '@', 1));

  insert into public.households (name, created_by)
  values ('Min økonomi', new.id)
  returning id into hid;

  insert into public.household_members (household_id, user_id, role)
  values (hid, new.id, 'owner');

  insert into public.financial_accounts (household_id, owner_user_id, name, type)
  values (hid, new.id, 'Brukskonto', 'checking')
  returning id into aid;

  perform public.seed_household(hid);

  insert into public.user_preferences (user_id, default_household_id, default_account_id)
  values (new.id, hid, aid);

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- Hurtigregistrering: oppretter butikk ved behov og lagrer i én operasjon
-- ============================================================

create function public.ensure_merchant(p_household_id uuid, p_name text)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  mid uuid;
begin
  if p_name is null or btrim(p_name) = '' then
    return null;
  end if;
  insert into public.merchants (household_id, name)
  values (p_household_id, btrim(regexp_replace(p_name, '\s+', ' ', 'g')))
  on conflict (household_id, normalized_name) do update set name = public.merchants.name
  returning id into mid;
  return mid;
end;
$$;

create function public.quick_add(
  p_household_id uuid,
  p_kind public.tx_kind,
  p_amount_ore bigint,
  p_merchant text,
  p_category_id uuid,
  p_occurred_on date,
  p_account_id uuid default null,
  p_note text default null
)
returns public.transactions
language plpgsql security invoker set search_path = ''
as $$
declare
  mid uuid;
  result public.transactions;
begin
  mid := public.ensure_merchant(p_household_id, p_merchant);

  insert into public.transactions
    (household_id, kind, amount_ore, merchant_id, category_id, account_id,
     occurred_on, description, note)
  values
    (p_household_id, p_kind, p_amount_ore, mid, p_category_id, p_account_id,
     p_occurred_on, nullif(btrim(p_merchant), ''), p_note)
  returning * into result;

  return result;
end;
$$;

-- Detaljert lagring: oppretter eller oppdaterer en transaksjon med butikk og splitt,
-- alt i én databasetransaksjon. Splittsummen sjekkes når funksjonen er ferdig.
create function public.save_transaction(
  p_id uuid,
  p_household_id uuid,
  p_kind public.tx_kind,
  p_amount_ore bigint,
  p_occurred_on date,
  p_merchant text default null,
  p_category_id uuid default null,
  p_account_id uuid default null,
  p_to_account_id uuid default null,
  p_note text default null,
  p_tags text[] default '{}',
  p_refund_of_id uuid default null,
  p_splits jsonb default '[]'
)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  mid uuid;
  tid uuid;
begin
  if jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 1 then
    raise exception 'Splitt må ha minst to linjer' using errcode = 'check_violation';
  end if;

  mid := public.ensure_merchant(p_household_id, p_merchant);

  if p_id is null then
    insert into public.transactions
      (household_id, kind, amount_ore, occurred_on, merchant_id, category_id, account_id,
       to_account_id, description, note, tags, refund_of_id)
    values
      (p_household_id, p_kind, p_amount_ore, p_occurred_on, mid, p_category_id, p_account_id,
       p_to_account_id, nullif(btrim(p_merchant), ''), nullif(btrim(p_note), ''),
       coalesce(p_tags, '{}'), p_refund_of_id)
    returning id into tid;
  else
    update public.transactions set
      kind = p_kind, amount_ore = p_amount_ore, occurred_on = p_occurred_on,
      merchant_id = mid, category_id = p_category_id, account_id = p_account_id,
      to_account_id = p_to_account_id, description = nullif(btrim(p_merchant), ''),
      note = nullif(btrim(p_note), ''), tags = coalesce(p_tags, '{}'), refund_of_id = p_refund_of_id
    where id = p_id and household_id = p_household_id
    returning id into tid;
    if tid is null then
      raise exception 'Fant ikke transaksjonen' using errcode = 'no_data_found';
    end if;
    delete from public.transaction_splits where transaction_id = tid;
  end if;

  insert into public.transaction_splits (transaction_id, household_id, category_id, amount_ore)
  select tid, p_household_id, nullif(e ->> 'category_id', '')::uuid, (e ->> 'amount_ore')::bigint
  from jsonb_array_elements(p_splits) e;

  return tid;
end;
$$;

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.financial_accounts enable row level security;
alter table public.categories enable row level security;
alter table public.merchants enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_splits enable row level security;
alter table public.user_preferences enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (public.mfa_ok() and (id = auth.uid() or exists (
    select 1 from public.household_members a
    join public.household_members b on a.household_id = b.household_id
    where a.user_id = auth.uid() and b.user_id = profiles.id)));
create policy profiles_update on public.profiles for update to authenticated
  using (public.mfa_ok() and id = auth.uid()) with check (id = auth.uid());

create policy households_select on public.households for select to authenticated
  using (public.mfa_ok() and public.is_member(id));
create policy households_update on public.households for update to authenticated
  using (public.mfa_ok() and exists (
    select 1 from public.household_members m
    where m.household_id = households.id and m.user_id = auth.uid() and m.role = 'owner'))
  with check (public.mfa_ok());

create policy members_select on public.household_members for select to authenticated
  using (public.mfa_ok() and public.is_member(household_id));

create policy accounts_all on public.financial_accounts for all to authenticated
  using (public.mfa_ok() and public.is_member(household_id))
  with check (public.mfa_ok() and public.is_member(household_id));

create policy categories_all on public.categories for all to authenticated
  using (public.mfa_ok() and public.is_member(household_id))
  with check (public.mfa_ok() and public.is_member(household_id));

create policy merchants_all on public.merchants for all to authenticated
  using (public.mfa_ok() and public.is_member(household_id))
  with check (public.mfa_ok() and public.is_member(household_id));

-- Private transaksjoner er bare synlige for den som opprettet dem.
create policy transactions_select on public.transactions for select to authenticated
  using (public.mfa_ok() and public.is_member(household_id)
         and (visibility = 'shared' or created_by = auth.uid()));
create policy transactions_insert on public.transactions for insert to authenticated
  with check (public.mfa_ok() and public.is_member(household_id) and created_by = auth.uid());
create policy transactions_update on public.transactions for update to authenticated
  using (public.mfa_ok() and public.is_member(household_id)
         and (visibility = 'shared' or created_by = auth.uid()))
  with check (public.mfa_ok() and public.is_member(household_id)
         and (visibility = 'shared' or created_by = auth.uid()));
create policy transactions_delete on public.transactions for delete to authenticated
  using (public.mfa_ok() and public.is_member(household_id)
         and (visibility = 'shared' or created_by = auth.uid()));

create policy splits_all on public.transaction_splits for all to authenticated
  using (public.mfa_ok() and exists (
    select 1 from public.transactions t where t.id = transaction_splits.transaction_id))
  with check (public.mfa_ok() and exists (
    select 1 from public.transactions t where t.id = transaction_splits.transaction_id));

create policy prefs_all on public.user_preferences for all to authenticated
  using (public.mfa_ok() and user_id = auth.uid())
  with check (public.mfa_ok() and user_id = auth.uid());

-- ============================================================
-- Rettigheter: anonyme får ingenting
-- ============================================================

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.quick_add(uuid, public.tx_kind, bigint, text, uuid, date, uuid, text) to authenticated;
grant execute on function public.ensure_merchant(uuid, text) to authenticated;
grant execute on function public.save_transaction(uuid, uuid, public.tx_kind, bigint, date, text, uuid, uuid, uuid, text, text[], uuid, jsonb) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.mfa_ok() to authenticated;
revoke insert, update, delete on public.households, public.household_members, public.profiles from authenticated;
grant update (name) on public.households to authenticated;
grant update (display_name) on public.profiles to authenticated;
-- Funksjoner som skal ha nye standardrettigheter for anon i fremtiden
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon, public;
