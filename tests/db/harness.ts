// Kjører migrasjonen mot en ekte Postgres (PGlite) med en minimal etterligning
// av Supabase sitt auth-skjema, slik at RLS kan testes uten nettverk.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const AUTH_STUB = `
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public, auth to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
-- Som i Supabase: nye tabeller og funksjoner i public gis automatisk til anon og authenticated
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`

export async function createDb() {
  const db = new PGlite()
  await db.exec(AUTH_STUB)
  const dir = join(import.meta.dirname, '../../supabase/migrations')
  for (const f of readdirSync(dir).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'))
  }
  return db
}

export type Db = Awaited<ReturnType<typeof createDb>>

export async function createUser(db: Db, id: string, email: string) {
  await db.query('reset role')
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email])
}

/** Kjører fn som en innlogget bruker. aal2 betyr at tofaktor er verifisert. */
export async function asUser<T>(
  db: Db,
  userId: string | null,
  fn: (q: Db['query']) => Promise<T>,
  aal: 'aal1' | 'aal2' = 'aal2',
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = userId ? JSON.stringify({ sub: userId, aal, role: 'authenticated' }) : ''
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
    await tx.query(userId ? 'set local role authenticated' : 'set local role anon')
    return fn(tx.query.bind(tx) as Db['query'])
  })
}
