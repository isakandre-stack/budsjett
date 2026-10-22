import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Brukes i oppsettet av Apple Pay-automasjonen på iPhone */
export const supabaseUrl = url ?? ''
export const publicKey = anonKey ?? ''

export const configured = Boolean(url && anonKey)

// Anon-nøkkelen er offentlig av natur. All beskyttelse ligger i innlogging,
// og Row Level Security i databasen.
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'budsjett-auth',
  },
})

/** Gjør Supabase-feil om til en melding som sier hva som skjedde. */
export function errorMessage(e: unknown): string {
  const msg = typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  if (/summerer ikke/.test(msg)) return 'Splittene må til sammen bli like mye som beløpet.'
  if (/Invalid login credentials/i.test(msg)) return 'Feil e-post eller passord.'
  if (/row-level security|permission denied/i.test(msg)) return 'Du har ikke tilgang til dette. Logg inn på nytt.'
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Fikk ikke kontakt med serveren. Sjekk nettet og prøv igjen.'
  if (/categories_household_id_parent_id_name_key|duplicate key/i.test(msg)) return 'Det finnes allerede en med samme navn.'
  if (/ett nivå/.test(msg)) return 'Underkategorier kan ikke ha egne underkategorier.'
  return msg
}
