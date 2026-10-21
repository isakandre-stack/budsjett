import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { useToast } from '../components/Toast'
import { useBudgetMutations, useTransactions, type Category } from '../lib/api'
import { monthOf, monthPeriod, shiftMonth, todayISO } from '../lib/dates'
import { summarize } from '../lib/finance'
import { formatOre, oreToInput, parseAmountToOre } from '../lib/money'
import { errorMessage } from '../lib/supabase'

export function BudgetPage() {
  const app = useApp()
  const today = todayISO()
  // De tre siste hele månedene, som hjelp til å sette et realistisk tall
  const last3 = useMemo(() => {
    const m = monthOf(today)
    return { from: monthPeriod(shiftMonth(m, -3)).from, to: monthPeriod(shiftMonth(m, -1)).to }
  }, [today])
  const q = useTransactions(app.householdId, last3)
  const avg = useMemo(() => {
    const map = new Map<string, number>()
    if (!q.data) return map
    for (const c of summarize(q.data, app.categories, last3, today).byCategory) if (c.id) map.set(c.id, Math.round(c.amountOre / 3))
    return map
  }, [q.data, app.categories, last3, today])

  const parents = app.categories.filter((c) => !c.parent_id && !c.is_archived && c.kind === 'expense')
  const budgetBy = new Map(app.budgets.map((b) => [b.category_id, b.amount_ore]))
  const total = app.budgets.filter((b) => parents.some((p) => p.id === b.category_id)).reduce((s, b) => s + b.amount_ore, 0)

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 pt-4 md:pt-8">
      <Link to="/innstillinger" className="text-sm font-semibold text-accent">Innstillinger</Link>
      <h1 className="text-2xl font-bold tracking-tight mt-1">Budsjett</h1>
      <p className="text-sm text-muted mt-1">
        Sett et beløp per måned for kategoriene du vil holde øye med. Oversikten viser hvor mye som er igjen,
        og varsler hvis du ligger an til å bruke mer. La feltet stå tomt for kategorier uten budsjett.
      </p>
      <p className="mt-4 rounded-xl bg-surface px-4 py-3 flex justify-between">
        <span>Totalt per måned</span>
        <span className="num font-semibold">{formatOre(total)}</span>
      </p>
      <ul className="mt-3 rounded-xl bg-surface divide-y divide-line">
        {parents.map((c) => <BudgetRow key={c.id} cat={c} current={budgetBy.get(c.id) ?? null} avg={avg.get(c.id) ?? 0} />)}
      </ul>
    </div>
  )
}

function BudgetRow({ cat, current, avg }: { cat: Category; current: number | null; avg: number }) {
  const { householdId } = useApp()
  const m = useBudgetMutations(householdId)
  const toast = useToast()
  const [text, setText] = useState(current ? oreToInput(current) : '')
  const [error, setError] = useState(false)

  const commit = () => {
    const t = text.trim()
    const ore = t ? parseAmountToOre(t) : null
    if (t && ore === null) { setError(true); return }
    setError(false)
    if (ore === current) return
    m.set.mutate({ categoryId: cat.id, amountOre: ore }, {
      onSuccess: () => {
        setText(ore ? oreToInput(ore) : '')
        toast({ text: ore ? `Budsjett for ${cat.name}: ${formatOre(ore)} i måneden` : `Budsjettet for ${cat.name} er fjernet` })
      },
      onError: (e) => { setText(current ? oreToInput(current) : ''); toast({ text: errorMessage(e), tone: 'error' }) },
    })
  }

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: cat.color ?? 'var(--muted)' }} />
      <label htmlFor={`b-${cat.id}`} className="flex-1 min-w-0">
        <span className="block truncate">{cat.name}</span>
        <span className="block text-xs text-muted num">{avg > 0 ? `Snitt siste 3 mnd: ${formatOre(avg, { decimals: 'never' })}` : 'Ingen forbruk siste 3 mnd'}</span>
      </label>
      <span className="relative w-32 shrink-0">
        <input id={`b-${cat.id}`} className="field num text-right pr-9" inputMode="decimal" placeholder="Ingen"
          aria-invalid={error} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted pointer-events-none">kr</span>
      </span>
    </li>
  )
}
