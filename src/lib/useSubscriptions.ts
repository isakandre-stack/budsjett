import { useMemo } from 'react'
import { useApp } from '../app/AppContext'
import { useIgnoredSubscriptions, useTransactions } from './api'
import { shiftDay, todayISO } from './dates'
import { KIND_EFFECT } from './finance'
import { findSubscriptions, subscriptionKey, totals } from './subscriptions'

/** Henter drøye 13 måneder med transaksjoner og finner abonnementer. Delt av oversikten og abonnementssiden. */
export function useSubscriptions() {
  const app = useApp()
  const today = todayISO()
  const range = useMemo(() => ({ from: shiftDay(today, -400), to: today }), [today])
  const q = useTransactions(app.householdId, range)
  const ignoredQ = useIgnoredSubscriptions(app.userId)
  const ignored = ignoredQ.data ?? []

  // Faste poster du allerede har lagt inn vises for seg, og samme tjeneste skal ikke telles to ganger
  const fixed = useMemo(() => app.recurring.filter((r) => r.is_active && KIND_EFFECT[r.kind].spending === 1), [app.recurring])
  const fixedKeys = useMemo(() => fixed.map((r) => subscriptionKey(r.merchant)), [fixed])

  const subs = useMemo(() => {
    if (!q.data) return null
    const names = new Map(app.merchants.map((m) => [m.id, m.name]))
    return findSubscriptions(q.data, names, today, { ignoredKeys: ignored, skipKeys: fixedKeys })
  }, [q.data, app.merchants, today, ignored.join('|'), fixedKeys.join('|')])

  const found = subs ? totals(subs) : null
  const fixedMonthlyOre = fixed.reduce((a, r) => a + r.amount_ore, 0)
  // Faste poster for kjente tjenester (Spotify, Netflix og lignende) regnes som abonnement. Husleie og strøm gjør ikke det.
  const fixedSubs = fixed.filter((r) => subscriptionKey(r.merchant).startsWith('k:'))
  const subsMonthlyOre = (found?.monthlyOre ?? 0) + fixedSubs.reduce((a, r) => a + r.amount_ore, 0)

  return {
    subs,
    txs: q.data ?? [],
    fixed,
    ignored,
    loading: q.isLoading,
    error: q.error as Error | null,
    /** Antall transaksjoner historikken bygger på, for å si fra når den er for kort */
    txCount: q.data?.filter((t) => t.occurred_on <= today).length ?? 0,
    oldestDate: q.data && q.data.length ? q.data[q.data.length - 1].occurred_on : null,
    found,
    fixedMonthlyOre,
    totalMonthlyOre: (found?.monthlyOre ?? 0) + fixedMonthlyOre,
    /** Bare abonnementer: det som er funnet, pluss faste poster for kjente tjenester */
    subsMonthlyOre,
    subsCount: (found?.count ?? 0) + fixedSubs.length,
  }
}
