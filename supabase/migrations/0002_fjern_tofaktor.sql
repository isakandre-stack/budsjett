-- Fjerner kravet om tofaktor. Innlogget bruker holder.
-- Row Level Security står fortsatt: man ser bare sin egen husholdning,
-- og anonyme får ingen tilgang.
create or replace function public.mfa_ok()
returns boolean
language sql stable set search_path = ''
as $$
  select auth.uid() is not null;
$$;
