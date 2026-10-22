-- Kjenner igjen vanlige norske butikker og kjeder, så kjøp får kategori uten at du setter den selv.
-- Rekkefølgen er alltid: 1) kategorien du har valgt for butikken før, 2) denne lista, 3) ingen.
-- Lista peker på kategorier ved navn (hovedkategori og eventuelt underkategori).
-- Har du gitt nytt navn til eller arkivert en kategori, brukes hovedkategorien, ellers hoppes regelen over.

create table public.category_rules (
  id integer generated always as identity primary key,
  priority integer not null default 100,
  -- Regulært uttrykk mot butikknavnet i små bokstaver, der alt som ikke er bokstav eller tall er mellomrom.
  -- Treffer bare hele ord. «kaf[eé][a-zæøå]*» treffer «kafe», «kafé» og «kafeen».
  pattern text not null,
  parent_name text not null,
  sub_name text
);

alter table public.category_rules enable row level security;
create policy category_rules_read on public.category_rules for select to authenticated using (true);
revoke all on public.category_rules from anon, authenticated;
grant select on public.category_rules to authenticated;

insert into public.category_rules (priority, pattern, parent_name, sub_name) values
  -- Spesifikke før generelle: «Coop Bygg» er ikke dagligvarer, «Apple Store» er ikke abonnement
  (10, 'coop bygg[a-zæøå]*|obs bygg|byggmax|maxbo|monter|optimera|jernia|clas ohlson|jula|rusta|europris|nille|tiger|søstrene grene|sostrene grene|ikea|jysk|bohus|skeidar|kid interiør|kid interior|princess|plantasjen|hageland|kremmerhuset|lampehuset|fargerike|jotun|mester grønn|mester gronn', 'Shopping', 'Hjem og interiør'),
  (10, 'apple store|elkjøp|elkjop|power|komplett|netonnet|proshop|dustin|multicom|kjell|kjell company|euronics|eplehuset', 'Shopping', 'Elektronikk'),
  (10, 'apple com bill|app store|itunes|icloud|google play|google one|google workspace|microsoft|adobe|openai|chatgpt|anthropic|claude ai|github|dropbox|notion|canva|1password', 'Abonnementer', 'Programvare'),
  (10, 'netflix|spotify|hbo max|hbo|viaplay|disney plus|disney|tv 2 play|tv2 play|youtube premium|youtube|apple tv|prime video|amazon prime|storytel|bookbeat|audible|tidal|crunchyroll|discovery plus', 'Abonnementer', 'Strømmetjenester'),
  (10, 'telenor|telia|talkmore|onecall|chili mobil|happybytes|altibox|lycamobile|mycall|my call|ice net|ice norge|ice as|fjordkraft mobil|nextgentel|globalconnect', 'Abonnementer', 'Mobil og internett'),
  (10, 'tibber|fjordkraft|hafslund|fortum|elvia|lyse|ishavskraft|motkraft|kildenkraft|norgesenergi|eidsiva', 'Bolig', 'Strøm'),
  (10, 'gjensidige|tryg|fremtind|frende|if skadeforsikring|if forsikring|storebrand forsikring|codan|eika forsikring|knif', 'Forsikring', null),
  (10, 'interflora|blomster[a-zæøå]*|florist|mester grønn blomster', 'Gaver', null),

  -- Transport
  (20, 'easypark|apcoa|onepark|aimo|aimo park|europark|q park|parkering[a-zæøå]*|parkman|bompenger|autopass|fjellinjen|ferde|vegfinans|skyttel|flexpark|parkpark', 'Transport og bil', 'Parkering og bom'),
  (20, 'circle k|esso|shell|uno x|unox|yx|st1|automat1|tesla supercharger|supercharger|ionity|mer lading|recharge|eviny|kople|fortum charge|lade[a-zæøå]*|bensin[a-zæøå]*|drivstoff', 'Transport og bil', 'Drivstoff og lading'),
  (20, 'ruter|vy|entur|atb|skyss|kolumbus|brakar|kringom|farte|flytoget|bysykkel|oslo bysykkel|voi|tier|ryde|dott|lime|bolt|uber|taxi|oslo taxi|norgestaxi|taxus|cabonline|trondheim taxi', 'Transport og bil', 'Kollektiv'),
  (20, 'mekonomen|biltema|bilvask[a-zæøå]*|bilverksted|verksted|dekk[a-zæøå]*|vianor|euromaster|statens vegvesen|vegvesen|naf|bilxtra|thansen|meko|eu kontroll', 'Transport og bil', 'Bilhold'),

  -- Reise
  (20, 'norwegian|sas|widerøe|wideroe|flyr|ryanair|klm|lufthansa|finnair|easyjet|wizz air|sj|go ahead|flysas|avinor', 'Reise og ferie', 'Fly og tog'),
  (20, 'hotel[a-zæøå]*|hotell[a-zæøå]*|scandic|thon|nordic choice|strawberry|clarion|quality hotel|comfort hotel|radisson|airbnb|booking com|hotels com|motel|camping|hostel|vandrerhjem|citybox|smarthotel|first hotel|best western', 'Reise og ferie', 'Overnatting'),

  -- Helse og trening
  (20, 'apotek[a-zæøå0-9]*|vitusapotek|vitus|boots|ditt apotek|legevakt|lege[a-zæøå]*|tannlege[a-zæøå]*|tannklinikk[a-zæøå]*|legesenter|fysioterapi[a-zæøå]*|kiropraktor|optiker|specsavers|synsam|brilleland|interoptik|klinikk[a-zæøå]*|helsestasjon|dr dropin|aleris|volvat|colosseum', 'Helse og trening', 'Lege og apotek'),
  (20, 'sats|evo|evo fitness|elixia|fresh fitness|3t|actic|friskis|friskis svettis|treningssenter|gym|crossfit|klatre[a-zæøå]*|svømmehall|badeland|xxl|intersport|sport 1|sport1|anton sport|g sport|g max|loplabbet|løplabbet', 'Helse og trening', 'Trening'),

  -- Underholdning
  (20, 'ticketmaster|tikkio|billettservice|eventim|hoopla|ticketco|checkin|kino|odeon|nordisk film|oslo kino|konsert[a-zæøå]*|teater[a-zæøå]*|operaen|museum|museet|bowling|escape|trampoline|tusenfryd|leos lekeland', 'Underholdning', 'Konsert og arrangement'),
  (20, 'steam|playstation|psn|xbox|nintendo|gamestop|outland|norli|ark|ark bokhandel|bokhandel|tanum|platekompaniet|panduro|hobby[a-zæøå]*|lekeland|br leker|toys r us|lekia|epic games|riot games|blizzard', 'Underholdning', 'Spill og hobby'),

  -- Klær
  (20, 'h m|hm|zara|cubus|carlings|dressmann|bik bok|weekday|lindex|kappahl|zalando|boozt|jack jones|vero moda|volt|match|footlocker|foot locker|skoringen|eurosko|nilson|din sko|ecco|nike|adidas|uniqlo|mango|bershka|pull bear|stormberg|bergans|helly hansen|norrøna|norrona|follestad|ferner jacobsen|steen strøm|steen strom|gina tricot|monki|arket|mens store', 'Shopping', 'Klær'),

  -- Mat og drikke
  (30, 'mcdonald s|mcdonalds|mc donalds|burger king|max burgers|max hamburgare|foodora|wolt|just eat|subway|kfc|domino s|dominos|pizzabakeren|dolly dimples|kebab[a-zæøå]*|taco bell|five guys|bastard burgers|o learys|chicken|sushi[a-zæøå]*|takeaway|take away|grill[a-zæøå]*|gatekjøkken|gatekjokken|pølse[a-zæøå]*', 'Restaurant og kafé', 'Takeaway'),
  (30, 'kaf[eé][a-zæøå]*|caf[eé][a-zæøå]*|kaffe[a-zæøå]*|coffee|espresso house|starbucks|kaffebrenneriet|godt brød|godt brod|baker[a-zæøå]*|bakery|w b samson|wb samson|backstube|united bakeries|joe the juice|joe juice|tim wendelboe|stockfleths|bakehuset|bakeriet|deli de luca|delideluca', 'Restaurant og kafé', 'Kafé'),
  (30, 'restaurant[a-zæøå]*|restaurang|bistro|brasserie|pizza[a-zæøå]*|pizzeria|trattoria|osteria|peppes|egon|olivia|tgi fridays|tapas|ramen|thai|indisk|vietnam[a-zæøå]*|steakhouse|bar|pub|vinbar|ølbar|olbar|brewpub|brygg[a-zæøå]*|kantine', 'Restaurant og kafé', 'Restaurant'),
  (40, 'narvesen|7 eleven|7eleven|mix|kiosk[a-zæøå]*|kioskdrift|automat', 'Mat og dagligvarer', 'Kiosk og bensinstasjon'),
  (40, 'rema|rema 1000|kiwi|coop|extra|coop extra|obs|prix|mega|coop mega|meny|spar|eurospar|joker|bunnpris|oda|kolonial|matkroken|nærbutikken|naerbutikken|holdbart|vinmonopolet|polet|matbørsen|matborsen|asia[a-zæøå]*|torgkjøp|frukt[a-zæøå]*|slakter[a-zæøå]*|fiskehandel|dagligvare[a-zæøå]*', 'Mat og dagligvarer', 'Dagligvarer');

-- Butikknavnet slik reglene ser det: små bokstaver, bare ord, med mellomrom i hver ende
create function public.merchant_words(p_text text)
returns text
language sql immutable set search_path = ''
as $$
  select ' ' || btrim(regexp_replace(lower(translate(coalesce(p_text, ''), 'ÆØÅÄÖÜÉÈ', 'æøåäöüéè')), '[^a-z0-9æøåäöüéè]+', ' ', 'g')) || ' '
$$;

-- Kategori fra lista for et butikknavn, i husholdningens egne kategorier. Null hvis ingen regel treffer.
create function public.rule_category(p_household_id uuid, p_merchant text)
returns uuid
language sql stable security invoker set search_path = ''
as $$
  select coalesce(sub.id, par.id)
    from public.category_rules r
    join public.categories par
      on par.household_id = p_household_id and par.parent_id is null and par.name = r.parent_name
     and not par.is_archived and par.kind = 'expense'
    left join public.categories sub
      on sub.household_id = p_household_id and sub.parent_id = par.id and sub.name = r.sub_name
     and not sub.is_archived
   where public.merchant_words(p_merchant) ~ (' (' || r.pattern || ') ')
   order by r.priority, r.id
   limit 1
$$;

-- Forslag for mange butikknavn på en gang, brukt av importen. Lært kategori går foran lista.
create function public.suggest_categories(p_household_id uuid, p_names text[])
returns table (name text, category_id uuid)
language sql stable security invoker set search_path = ''
as $$
  select n.name,
         coalesce(
           (select m.default_category_id from public.merchants m
             where m.household_id = p_household_id and m.default_category_id is not null
               and (m.normalized_name = lower(btrim(regexp_replace(n.name, '\s+', ' ', 'g')))
                    or lower(n.name) like replace(replace(m.normalized_name, '%', '\%'), '_', '\_') || ' %')
             order by length(m.normalized_name) desc limit 1),
           public.rule_category(p_household_id, n.name))
    from unnest(p_names[1:2000]) as n(name)
$$;

-- Apple Pay bruker lista når butikken ikke har en kategori fra før
create or replace function public.applepay_ingest(p_token text, p_amount text, p_merchant text default null, p_card text default null)
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

  if (select count(*) from public.transactions
       where household_id = tok.household_id and source = 'applepay'
         and created_at > now() - interval '1 day') >= 300 then
    raise exception 'For mange kjøp på kort tid' using errcode = 'check_violation';
  end if;

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
    if cat is null then
      cat := public.rule_category(tok.household_id, merchant_name);
    end if;
  end if;

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

-- Kjøp som allerede ligger uten kategori får en fra lista, hvis den kjenner butikken.
-- Rører aldri transaksjoner som har kategori, splittede kjøp eller inntekter.
update public.transactions t
   set category_id = public.rule_category(t.household_id, coalesce(m.name, t.description))
  from public.merchants m
 where m.id = t.merchant_id
   and t.category_id is null and t.kind = 'expense'
   and not exists (select 1 from public.transaction_splits s where s.transaction_id = t.id)
   and public.rule_category(t.household_id, coalesce(m.name, t.description)) is not null;

revoke execute on function public.merchant_words(text) from public, anon;
revoke execute on function public.rule_category(uuid, text) from public, anon;
revoke execute on function public.suggest_categories(uuid, text[]) from public, anon;
revoke execute on function public.applepay_ingest(text, text, text, text) from public, authenticated;
grant execute on function public.merchant_words(text) to authenticated;
grant execute on function public.rule_category(uuid, text) to authenticated;
grant execute on function public.suggest_categories(uuid, text[]) to authenticated;
grant execute on function public.applepay_ingest(text, text, text, text) to anon;
