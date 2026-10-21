-- Budsjett per kategori, faste utgifter og inntekter, og import fra banken.

-- ============================================================
-- Budsjett: et månedlig beløp per hovedkategori
-- ============================================================

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  category_id uuid not null,
  amount_ore bigint not null check (amount_ore > 0 and amount_ore < 100000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, category_id),
  foreign key (category_id, household_id)
    references public.categories (id, household_id) on delete cascade
);

-- ============================================================
-- Faste poster: husleie, abonnementer, lønn og lignende.
-- Registreres automatisk som transaksjoner på riktig dag hver måned.
-- ============================================================

create table public.recurring (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  kind public.tx_kind not null check (kind in ('expense', 'income', 'saving', 'loan_principal', 'interest_fee')),
  amount_ore bigint not null check (amount_ore > 0 and amount_ore < 100000000000),
  merchant text not null check (char_length(btrim(merchant)) between 1 and 80),
  category_id uuid,
  account_id uuid,
  -- 31 betyr siste dag i måneden når måneden er kortere
  day_of_month smallint not null check (day_of_month between 1 and 31),
  start_on date not null,
  end_on date check (end_on is null or end_on >= start_on),
  -- Siste dato som er registrert. Sletter du en registrert transaksjon, lages den ikke på nytt.
  last_generated_on date,
  is_active boolean not null default true,
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (category_id, household_id)
    references public.categories (id, household_id) on delete set null (category_id),
  foreign key (account_id, household_id)
    references public.financial_accounts (id, household_id) on delete set null (account_id)
);
create index recurring_household_idx on public.recurring (household_id);

alter table public.transactions add column recurring_id uuid;
alter table public.transactions
  add foreign key (recurring_id, household_id)
  references public.recurring (id, household_id) on delete set null (recurring_id);
-- Én fast post kan aldri gi to transaksjoner på samme dag
create unique index transactions_recurring_once on public.transactions (recurring_id, occurred_on)
  where recurring_id is not null;

-- ============================================================
-- Import: hver bankrad får en nøkkel, så samme fil kan importeres
-- flere ganger uten at noe kommer dobbelt.
-- ============================================================

alter table public.transactions add column import_key text check (char_length(import_key) <= 200);
create unique index transactions_import_key on public.transactions (household_id, import_key)
  where import_key is not null;

-- ============================================================
-- Funksjoner
-- ============================================================

-- Registrerer alle faste poster som har forfalt til og med i dag (norsk tid).
-- Trygg å kalle ofte og fra flere enheter samtidig. Høyst én registrering per post per måned,
-- også om du endrer dagen. p_today brukes bare i tester.
create function public.generate_recurring(p_household_id uuid, p_today date default null)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  r record;
  m date;
  d date;
  dom integer;
  today date := coalesce(p_today, (now() at time zone 'Europe/Oslo')::date);
  mid uuid;
  inserted integer;
  total integer := 0;
  guard integer;
begin
  for r in
    select * from public.recurring
    where household_id = p_household_id and is_active
    order by created_at
    for update
  loop
    m := case when r.last_generated_on is null then date_trunc('month', r.start_on)::date
              else (date_trunc('month', r.last_generated_on) + interval '1 month')::date end;
    guard := 0;
    loop
      guard := guard + 1;
      exit when guard > 240;
      dom := least(r.day_of_month, extract(day from (m + interval '1 month' - interval '1 day'))::integer);
      d := m + (dom - 1);
      exit when d > today or (r.end_on is not null and d > r.end_on);
      if d >= r.start_on then
        mid := public.ensure_merchant(p_household_id, r.merchant);
        insert into public.transactions
          (household_id, kind, amount_ore, occurred_on, merchant_id, category_id, account_id,
           description, note, recurring_id)
        values
          (p_household_id, r.kind, r.amount_ore, d, mid, r.category_id, r.account_id,
           btrim(r.merchant), r.note, r.id)
        on conflict do nothing;
        get diagnostics inserted = row_count;
        total := total + inserted;
        update public.recurring set last_generated_on = d where id = r.id;
        r.last_generated_on := d;
      end if;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;
  return total;
end;
$$;

-- Importerer rader fra banken i én operasjon. Rader som er importert før hoppes over.
-- Hver rad: { key, date, amount_ore, kind, merchant, category_id, note }
create function public.import_transactions(p_household_id uuid, p_account_id uuid, p_rows jsonb)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  e jsonb;
  mid uuid;
  inserted integer;
  total integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Ugyldig import' using errcode = 'check_violation';
  end if;
  for e in select * from jsonb_array_elements(p_rows) loop
    if (e ->> 'kind') not in ('expense', 'income', 'refund', 'saving') then
      raise exception 'Ugyldig type i import' using errcode = 'check_violation';
    end if;
    mid := public.ensure_merchant(p_household_id, e ->> 'merchant');
    insert into public.transactions
      (household_id, kind, amount_ore, occurred_on, merchant_id, category_id, account_id,
       description, note, import_key)
    values
      (p_household_id, (e ->> 'kind')::public.tx_kind, (e ->> 'amount_ore')::bigint, (e ->> 'date')::date,
       mid, nullif(e ->> 'category_id', '')::uuid, p_account_id,
       nullif(btrim(e ->> 'merchant'), ''), nullif(btrim(e ->> 'note'), ''), e ->> 'key')
    on conflict do nothing;
    get diagnostics inserted = row_count;
    total := total + inserted;
  end loop;
  return total;
end;
$$;

-- ============================================================
-- Tilgang
-- ============================================================

alter table public.budgets enable row level security;
alter table public.recurring enable row level security;

create policy budgets_all on public.budgets for all to authenticated
  using (public.mfa_ok() and public.is_member(household_id))
  with check (public.mfa_ok() and public.is_member(household_id));

create policy recurring_all on public.recurring for all to authenticated
  using (public.mfa_ok() and public.is_member(household_id))
  with check (public.mfa_ok() and public.is_member(household_id));

revoke all on public.budgets, public.recurring from anon;
grant select, insert, update, delete on public.budgets, public.recurring to authenticated;

revoke execute on function public.generate_recurring(uuid, date) from public, anon;
revoke execute on function public.import_transactions(uuid, uuid, jsonb) from public, anon;
grant execute on function public.generate_recurring(uuid, date) to authenticated;
grant execute on function public.import_transactions(uuid, uuid, jsonb) to authenticated;
