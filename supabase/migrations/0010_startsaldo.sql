-- Startsaldo per konto. Saldoen i appen er startsaldoen pluss alt som er ført på kontoen fra og med datoen.
-- For kredittkort og lån er saldoen negativ når du skylder penger.
alter table public.financial_accounts
  add column opening_balance_ore bigint check (abs(opening_balance_ore) < 100000000000),
  add column opening_balance_on date,
  add constraint financial_accounts_opening_both
    check ((opening_balance_ore is null) = (opening_balance_on is null));

-- Import kan nå også føre overføringer mellom egne kontoer, så saldoen stemmer.
-- For en overføring sier "direction" om pengene gikk ut av eller inn på kontoen som importeres,
-- og "other_account_id" er den andre kontoen (kan være tom hvis den ikke er lagt inn i appen).
create or replace function public.import_transactions(p_household_id uuid, p_account_id uuid, p_rows jsonb)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  e jsonb;
  mid uuid;
  other uuid;
  acc uuid;
  toacc uuid;
  inserted integer;
  total integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Ugyldig import' using errcode = 'check_violation';
  end if;
  for e in select * from jsonb_array_elements(p_rows) loop
    if (e ->> 'kind') not in ('expense', 'income', 'refund', 'saving', 'transfer') then
      raise exception 'Ugyldig type i import' using errcode = 'check_violation';
    end if;
    if (e ->> 'kind') = 'transfer' then
      other := nullif(e ->> 'other_account_id', '')::uuid;
      if other is not null and other = p_account_id then other := null; end if;
      if (e ->> 'direction') = 'in' then acc := other; toacc := p_account_id;
      else acc := p_account_id; toacc := other; end if;
      insert into public.transactions
        (household_id, kind, amount_ore, occurred_on, account_id, to_account_id, description, note, import_key)
      values
        (p_household_id, 'transfer', (e ->> 'amount_ore')::bigint, (e ->> 'date')::date, acc, toacc,
         nullif(btrim(e ->> 'merchant'), ''), nullif(btrim(e ->> 'note'), ''), e ->> 'key')
      on conflict do nothing;
    else
      mid := public.ensure_merchant(p_household_id, e ->> 'merchant');
      insert into public.transactions
        (household_id, kind, amount_ore, occurred_on, merchant_id, category_id, account_id,
         description, note, import_key)
      values
        (p_household_id, (e ->> 'kind')::public.tx_kind, (e ->> 'amount_ore')::bigint, (e ->> 'date')::date,
         mid, nullif(e ->> 'category_id', '')::uuid, p_account_id,
         nullif(btrim(e ->> 'merchant'), ''), nullif(btrim(e ->> 'note'), ''), e ->> 'key')
      on conflict do nothing;
    end if;
    get diagnostics inserted = row_count;
    total := total + inserted;
  end loop;
  return total;
end;
$$;
