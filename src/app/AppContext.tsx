import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyTheme } from '../lib/theme'
import type { Session } from '@supabase/supabase-js'
import { useAccounts, useBootstrap, useCategories, useMerchants, type Account, type Category, type Merchant, type Transaction } from '../lib/api'
import { monthOf, monthPeriod, todayISO, yearPeriod, type Month, type Period } from '../lib/dates'

export type PeriodSel =
  | { mode: 'month'; month: Month }
  | { mode: 'year'; year: number }
  | { mode: 'custom'; from: string; to: string }

export function periodOf(sel: PeriodSel): Period {
  if (sel.mode === 'month') return monthPeriod(sel.month)
  if (sel.mode === 'year') return yearPeriod(sel.year)
  return { from: sel.from, to: sel.to }
}

/** Det som åpner registreringsvinduet: tomt, en eksisterende transaksjon, eller et forhåndsutfylt utkast. */
export type EditorTarget =
  | { type: 'new'; draft?: Partial<Transaction> & { merchantName?: string } }
  | { type: 'edit'; tx: Transaction }

interface Ctx {
  userId: string
  email: string
  householdId: string
  defaultAccountId: string | null
  categories: Category[]
  merchants: Merchant[]
  accounts: Account[]
  catById: Map<string, Category>
  merchantById: Map<string, Merchant>
  period: PeriodSel
  setPeriod: (p: PeriodSel) => void
  quickOpen: boolean
  setQuickOpen: (v: boolean) => void
  editor: EditorTarget | null
  setEditor: (e: EditorTarget | null) => void
}

const AppCtx = createContext<Ctx | null>(null)

export function useApp() {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp utenfor AppProvider')
  return c
}

export function AppProvider({ session, children }: { session: Session; children: ReactNode }) {
  const boot = useBootstrap()
  const hid = boot.data?.householdId
  const cats = useCategories(hid)
  const merchants = useMerchants(hid)
  const accounts = useAccounts(hid)
  const [period, setPeriod] = useState<PeriodSel>({ mode: 'month', month: monthOf(todayISO()) })
  const [quickOpen, setQuickOpen] = useState(false)
  const [editor, setEditor] = useState<EditorTarget | null>(null)

  // Temaet følger brukeren mellom enheter
  const serverTheme = boot.data?.theme
  useEffect(() => { if (serverTheme) applyTheme(serverTheme) }, [serverTheme])

  const value = useMemo<Ctx | null>(() => {
    if (!boot.data || !cats.data || !merchants.data || !accounts.data) return null
    return {
      userId: session.user.id,
      email: session.user.email ?? '',
      householdId: boot.data.householdId,
      // En arkivert konto skal aldri brukes som standard for nye kjøp
      defaultAccountId: accounts.data.some((a) => a.id === boot.data.defaultAccountId && !a.is_archived) ? boot.data.defaultAccountId : null,
      categories: cats.data,
      merchants: merchants.data,
      accounts: accounts.data,
      catById: new Map(cats.data.map((c) => [c.id, c])),
      merchantById: new Map(merchants.data.map((m) => [m.id, m])),
      period,
      setPeriod,
      quickOpen,
      setQuickOpen,
      editor,
      setEditor,
    }
  }, [boot.data, cats.data, merchants.data, accounts.data, session, period, quickOpen, editor])

  const err = boot.error ?? cats.error ?? merchants.error ?? accounts.error
  if (err) {
    return (
      <main className="min-h-dvh grid place-items-center p-6 text-center">
        <div>
          <p className="text-bad mb-4">Klarte ikke å hente data: {(err as Error).message}</p>
          <button className="btn btn-primary" onClick={() => location.reload()}>Prøv igjen</button>
        </div>
      </main>
    )
  }
  if (!value) return <main className="min-h-dvh grid place-items-center text-muted">Henter oversikten…</main>
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
