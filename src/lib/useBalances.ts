import { useMemo } from 'react'
import { useApp } from '../app/AppContext'
import { useTransactions } from './api'
import { accountBalances } from './balance'
import { todayISO } from './dates'

/** Saldo nå for hver konto som har startsaldo. Henter transaksjonene fra den tidligste startdatoen. */
export function useBalances() {
  const app = useApp()
  const today = todayISO()
  const from = app.accounts.map((a) => a.opening_balance_on).filter((d): d is string => !!d).sort()[0]
  const q = useTransactions(from ? app.householdId : undefined, { from: from ?? today, to: today })
  const balances = useMemo(() => (q.data ? accountBalances(app.accounts, q.data, today) : null), [q.data, app.accounts, today])
  return { balances, hasAny: !!from, loading: !!from && q.isLoading }
}
