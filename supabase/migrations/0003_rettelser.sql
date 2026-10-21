-- Rettelser etter fase 1. Kan kjøres flere ganger uten skade.

-- 1. Butikker telles som brukt også når kjøpet ikke har kategori.
--    Før ble use_count bare økt når kategori var valgt, så butikker du
--    registrerte uten kategori dukket aldri opp blant snarveiene.
--    En endring uten kategori visker heller ikke ut kategorien butikken husker.
create or replace function public.tx_learn_merchant()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.merchant_id is not null then
    update public.merchants
       set default_category_id = coalesce(new.category_id, default_category_id),
           use_count = use_count + case when tg_op = 'INSERT' then 1 else 0 end,
           last_used_at = now()
     where id = new.merchant_id;
  end if;
  return null;
end;
$$;

-- 2. En hovedkategori som har underkategorier kan ikke flyttes inn under en annen,
--    ellers ville det blitt tre nivåer.
create or replace function public.category_before_write()
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
    if tg_op = 'UPDATE' and exists (select 1 from public.categories c where c.parent_id = new.id) then
      raise exception 'Kategorier kan bare ha ett nivå med underkategorier';
    end if;
    new.kind := parent_kind;
  end if;
  return new;
end;
$$;
