-- Automatisk føring av Apple Pay-kjøp.
-- En automasjon i Snarveier på iPhone sender beløp og butikk hit hver gang du betaler.
-- Den logger ikke inn. I stedet har den en lang, tilfeldig nøkkel som bare din telefon kjenner.
-- Nøkkelen lagres bare som SHA-256, så den kan ikke leses ut av databasen.

alter table public.transactions add column source text check (source in ('applepay'));

create table public.ingest_tokens (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash bytea not null unique,
  label text not null default 'iPhone' check (char_length(label) between 1 and 60),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);
create index ingest_tokens_user_idx on public.ingest_tokens (user_id);

alter table public.ingest_tokens enable row level security;
-- Du ser og sletter bare dine egne nøkler. Nye lages bare via create_ingest_token.
create policy ingest_tokens_select on public.ingest_tokens for select to authenticated
  using (public.mfa_ok() and user_id = auth.uid());
create policy ingest_tokens_delete on public.ingest_tokens for delete to authenticated
  using (public.mfa_ok() and user_id = auth.uid());

revoke all on public.ingest_tokens from anon, authenticated;
grant select (id, household_id, user_id, label, created_at, last_used_at), delete on public.ingest_tokens to authenticated;

-- Lager en ny nøkkel og gir den tilbake i klartekst. Det er eneste gang den kan leses.
create function public.create_ingest_token(p_household_id uuid, p_label text default 'iPhone')
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  token text;
begin
  if uid is null or not public.mfa_ok() or not public.is_member(p_household_id) then
    raise exception 'Ingen tilgang' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from public.ingest_tokens where user_id = uid) >= 5 then
    raise exception 'Du har allerede fem tilkoblinger. Slett en før du lager en ny.' using errcode = 'check_violation';
  end if;
  -- To tilfeldige UUID-er gir 244 tilfeldige bit
  token := 'bt_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.ingest_tokens (household_id, user_id, token_hash, label)
  values (p_household_id, uid, sha256(convert_to(token, 'UTF8')),
          coalesce(nullif(btrim(left(p_label, 60)), ''), 'iPhone'));
  return token;
end;
$$;

-- Tolker beløp slik Snarveier skriver dem, for eksempel «kr 1 234,50», «129,00 kr», «NOK 99» eller «12.5».
-- Gir øre, negativt for penger inn. Null hvis teksten ikke er et beløp.
create function public.parse_amount_ore(p_text text)
returns bigint
language plpgsql immutable set search_path = ''
as $$
declare
  t text;
  neg boolean;
  last_sep integer;
  int_part text;
  dec_part text;
begin
  if p_text is null then return null; end if;
  neg := p_text ~ '(^|[^0-9])[-−]\s*[0-9]' or p_text ~ '^\s*[-−]';
  t := regexp_replace(p_text, '[^0-9.,]', '', 'g');
  t := regexp_replace(t, '^[.,]+|[.,]+$', '', 'g');
  if t = '' or t !~ '[0-9]' then return null; end if;
  -- Siste skilletegn er desimaltegn hvis det har én eller to sifre etter seg, ellers tusenskille
  last_sep := length(t) - length(regexp_replace(t, '^.*[.,]', ''));
  if last_sep = 0 then
    int_part := t; dec_part := '';
  elsif length(t) - last_sep between 1 and 2 then
    int_part := regexp_replace(left(t, last_sep - 1), '[.,]', '', 'g');
    dec_part := substr(t, last_sep + 1);
  else
    int_part := regexp_replace(t, '[.,]', '', 'g'); dec_part := '';
  end if;
  if int_part = '' then int_part := '0'; end if;
  if length(int_part) > 11 then return null; end if;
  return (case when neg then -1 else 1 end) * (int_part::bigint * 100 + rpad(dec_part, 2, '0')::bigint);
end;
$$;

-- Tar imot ett kjøp fra telefonen. Kalles uten innlogging, men krever gyldig nøkkel.
create function public.applepay_ingest(p_token text, p_amount text, p_merchant text default null, p_card text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  tok public.ingest_tokens;
  ore bigint;
  v_kind public.tx_kind;
  q text;
  merchant_name text;
  mid uuid;
  cat uuid;
  acc uuid;
  now_oslo timestamp := now() at time zone 'Europe/Oslo';
  existing uuid;
  tid uuid;
  cat_name text;
begin
  if p_token is null or char_length(p_token) > 200 then
    raise exception 'Ugyldig nøkkel' using errcode = 'insufficient_privilege';
  end if;
  select * into tok from public.ingest_tokens where token_hash = sha256(convert_to(btrim(p_token), 'UTF8'));
  if not found then
    raise exception 'Ugyldig nøkkel' using errcode = 'insufficient_privilege';
  end if;

  ore := public.parse_amount_ore(left(p_amount, 60));
  if ore is null or ore = 0 then
    raise exception 'Fant ikke noe beløp i «%»', left(p_amount, 60) using errcode = 'check_violation';
  end if;
  v_kind := case when ore < 0 then 'refund' else 'expense' end;
  ore := abs(ore);

  -- Ikke mer enn 300 kjøp i døgnet per nøkkel, i tilfelle noe går i løkke
  if (select count(*) from public.transactions
       where household_id = tok.household_id and source = 'applepay'
         and created_at > now() - interval '1 day') >= 300 then
    raise exception 'For mange kjøp på kort tid' using errcode = 'check_violation';
  end if;

  -- Butikknavn: «REMA 1000 LILLESTRØM» kobles til en butikk du har fra før, som «Rema 1000»
  merchant_name := nullif(btrim(regexp_replace(left(coalesce(p_merchant, ''), 80), '\s+', ' ', 'g')), '');
  if merchant_name is not null then
    q := lower(merchant_name);
    select m.id into mid from public.merchants m
     where m.household_id = tok.household_id
       and (q = m.normalized_name or q like replace(replace(m.normalized_name, '%', '\%'), '_', '\_') || ' %')
     order by length(m.normalized_name) desc
     limit 1;
    if mid is null then
      mid := public.ensure_merchant(tok.household_id, merchant_name);
    end if;
    select c.id into cat
      from public.merchants m join public.categories c on c.id = m.default_category_id
     where m.id = mid and not c.is_archived
       and c.kind = case when v_kind = 'expense' then 'expense'::public.category_kind else c.kind end;
  end if;

  -- Samme kjøp sendt to ganger (automasjonen kan slå til to ganger) føres bare én gang
  select t.id into existing from public.transactions t
   where t.household_id = tok.household_id and t.source = 'applepay'
     and t.amount_ore = ore and t.merchant_id is not distinct from mid
     and t.created_at > now() - interval '2 minutes'
   limit 1;
  if existing is not null then
    return jsonb_build_object('id', existing, 'duplicate', true);
  end if;

  select p.default_account_id into acc from public.user_preferences p
   where p.user_id = tok.user_id and p.default_household_id = tok.household_id;

  insert into public.transactions
    (household_id, created_by, kind, amount_ore, occurred_on, occurred_time, merchant_id, category_id,
     account_id, description, note, source)
  values
    (tok.household_id, tok.user_id, v_kind, ore, now_oslo::date, date_trunc('minute', now_oslo)::time, mid, cat,
     acc, coalesce((select name from public.merchants where id = mid), merchant_name),
     nullif(btrim(concat_ws(' ', 'Apple Pay', nullif(btrim(left(p_card, 60)), ''))), ''), 'applepay')
  returning id into tid;

  update public.ingest_tokens set last_used_at = now() where id = tok.id;

  select name into cat_name from public.categories where id = cat;
  return jsonb_build_object('id', tid, 'amount_ore', ore, 'merchant', merchant_name, 'category', cat_name);
end;
$$;

revoke execute on function public.create_ingest_token(uuid, text) from public, anon;
revoke execute on function public.parse_amount_ore(text) from public, anon;
revoke execute on function public.applepay_ingest(text, text, text, text) from public;
grant execute on function public.create_ingest_token(uuid, text) to authenticated;
grant execute on function public.parse_amount_ore(text) to authenticated;
revoke execute on function public.applepay_ingest(text, text, text, text) from authenticated;
-- Bevisst åpen for anon: telefonen logger ikke inn, nøkkelen er beskyttelsen
grant execute on function public.applepay_ingest(text, text, text, text) to anon;
