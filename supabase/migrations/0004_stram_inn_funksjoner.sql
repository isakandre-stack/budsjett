-- Supabase gir innloggede brukere tilgang til nye funksjoner automatisk, så sperren
-- i 0001 slo ikke inn i den ekte databasen. Disse to skal bare kjøres av databasen selv
-- (når en ny bruker opprettes), aldri kalles fra appen.
revoke execute on function public.seed_household(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
