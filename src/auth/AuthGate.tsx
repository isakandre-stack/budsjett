import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { errorMessage, supabase } from '../lib/supabase'
import { Logo } from '../components/Logo'

type State =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'ready'; session: Session }

async function resolve(session: Session | null): Promise<State> {
  return session ? { status: 'ready', session } : { status: 'signedOut' }
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
      } else if (event === 'SIGNED_IN') {
        // Kjøres utenfor callbacken for å unngå vranglås i supabase-js
        setTimeout(() => void refresh(), 0)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [refresh, qc])

  if (fatal) return <Shell><p className="text-bad">{fatal}</p><button className="btn btn-ghost mt-4" onClick={() => location.reload()}>Last inn på nytt</button></Shell>
  if (state.status === 'loading') return <Shell><p className="text-muted">Laster…</p></Shell>
  if (state.status === 'signedOut') return <Login />
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
