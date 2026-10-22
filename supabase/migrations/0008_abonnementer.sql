-- Abonnementsjeger: tjenester du har sagt ikke er abonnement, så de ikke dukker opp igjen.
-- Selve deteksjonen skjer i appen ut fra transaksjonene. Følger brukeren mellom enheter.

alter table public.user_preferences
  add column ignored_subscriptions text[] not null default '{}'
  check (cardinality(ignored_subscriptions) <= 500);
