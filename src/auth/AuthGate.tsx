import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { errorMessage, supabase } from '../lib/supabase'
import { Logo } from '../components/Logo'

type State =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'enroll'; session: Session }
  | { status: 'challenge'; session: Session; factorId: string }
  | { status: 'ready'; session: Session }

async function resolve(session: Session | null): Promise<State> {
  if (!session) return { status: 'signedOut' }
  const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw error
  if (aal.currentLevel === 'aal2') return { status: 'ready', session }
  const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors()
  if (fErr) throw fErr
  const verified = factors.totp.find((f) => f.status === 'verified')
  if (verified) return { status: 'challenge', session, factorId: verified.id }
  return { status: 'enroll', session }
}

export function AuthGate({ children }: { children: (session: Session) => ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [fatal, setFatal] = useState<string | null>(null)
  const qc = useQueryClient()

  const refresh = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession()
      setState(await resolve(data.session))
    } catch (e) {
      setFatal(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        qc.clear()
        setState({ status: 'signedOut' })
      } else if (event === 'SIGNED_IN' || event === 'MFA_CHALLENGE_VERIFIED') {
        // Kjøres utenfor callbacken for å unngå vranglås i supabase-js
        setTimeout(() => void refresh(), 0)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [refresh, qc])

  if (fatal) return <Shell><p className="text-bad">{fatal}</p><button className="btn btn-ghost mt-4" onClick={() => location.reload()}>Last inn på nytt</button></Shell>
  if (state.status === 'loading') return <Shell><p className="text-muted">Laster…</p></Shell>
  if (state.status === 'signedOut') return <Login />
  if (state.status === 'enroll') return <Enroll onDone={refresh} />
  if (state.status === 'challenge') return <Challenge factorId={state.factorId} onDone={refresh} />
  return <>{children(state.session)}</>
}

function Shell({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8"><Logo /><span className="font-bold text-lg">Budsjett</span></div>
        {title && <h1 className="text-2xl font-bold mb-6 tracking-tight">{title}</h1>}
        {children}
      </div>
    </main>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(errorMessage(error))
  }

  return (
    <Shell title="Logg inn">
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="text-sm text-muted">E-post</span>
          <input className="field mt-1" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm text-muted">Passord</span>
          <input className="field mt-1" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p role="alert" className="text-bad text-sm">{error}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Logger inn…' : 'Logg inn'}</button>
      </form>
    </Shell>
  )
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className="field num text-center text-2xl tracking-[0.4em]"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={6}
      autoFocus
      required
      aria-label="Sekssifret kode"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
    />
  )
}

function Challenge({ factorId, onDone }: { factorId: string; onDone: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    setBusy(false)
    if (error) {
      setError(errorMessage(error))
      setCode('')
    } else onDone()
  }

  return (
    <Shell title="Bekreft at det er deg">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-muted">Skriv inn koden fra autentiseringsappen.</p>
        <CodeInput value={code} onChange={setCode} />
        {error && <p role="alert" className="text-bad text-sm">{error}</p>}
        <button className="btn btn-primary w-full" disabled={busy || code.length !== 6}>{busy ? 'Sjekker…' : 'Bekreft'}</button>
        <button type="button" className="btn btn-ghost w-full" onClick={() => supabase.auth.signOut()}>Logg ut</button>
      </form>
    </Shell>
  )
}

function Enroll({ onDone }: { onDone: () => void }) {
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Rydd bort halvferdige oppsett fra tidligere forsøk
      const { data } = await supabase.auth.mfa.listFactors()
      for (const f of data?.all ?? []) {
        if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      const { data: enrolled, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Budsjett ${new Date().toISOString().slice(0, 10)}` })
      if (cancelled) return
      if (error) setError(errorMessage(error))
      else setFactor({ id: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret })
    })()
    return () => { cancelled = true }
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!factor) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
    setBusy(false)
    if (error) {
      setError(errorMessage(error))
      setCode('')
    } else onDone()
  }

  return (
    <Shell title="Slå på tofaktor">
      <p className="text-muted mb-4">
        Økonomien din er bare tilgjengelig med tofaktor. Skann koden med en autentiseringsapp, for eksempel Google Authenticator, Microsoft Authenticator eller 1Password.
      </p>
      {factor ? (
        <form onSubmit={submit} className="space-y-4">
          <div className="bg-white rounded-xl p-3 w-fit mx-auto">
            <img src={factor.qr} alt="QR-kode for tofaktor" width={180} height={180} />
          </div>
          <details className="text-sm text-muted">
            <summary className="cursor-pointer">Kan ikke skanne? Skriv inn nøkkelen manuelt</summary>
            <code className="num block mt-2 break-all select-all text-ink">{factor.secret}</code>
          </details>
          <CodeInput value={code} onChange={setCode} />
          {error && <p role="alert" className="text-bad text-sm">{error}</p>}
          <button className="btn btn-primary w-full" disabled={busy || code.length !== 6}>{busy ? 'Sjekker…' : 'Slå på tofaktor'}</button>
        </form>
      ) : (
        error ? <p role="alert" className="text-bad text-sm">{error}</p> : <p className="text-muted">Lager QR-kode…</p>
      )}
      <button type="button" className="btn btn-ghost w-full mt-2" onClick={() => supabase.auth.signOut()}>Logg ut</button>
    </Shell>
  )
}
