import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { periodOf, useApp } from '../app/AppContext'
import { MonthStrip } from '../components/MonthStrip'
import { PeriodPicker } from '../components/PeriodPicker'
import { TxRow } from '../components/TxRow'
import { useTransactions } from '../lib/api'
import { monthLabel, monthOf, todayISO } from '../lib/dates'
import { budgetFactor, budgetStatus, compareWithPrevious, previousComparablePeriod, summarize, upcomingFixedSpending, type BudgetStatus } from '../lib/finance'
import { formatOre } from '../lib/money'
import { useSubscriptions } from '../lib/useSubscriptions'

export function Dashboard() {
  const app = useApp()
  const period = periodOf(app.period)
  const today = todayISO()
  const q = useTransactions(app.householdId, period)
  const navigate = useNavigate()
  const upcomingFixed = useMemo(() => upcomingFixedSpending(app.recurring, period, today), [app.recurring, period.from, period.to, today])
  const s = useMemo(() => (q.data ? summarize(q.data, app.categories, period, today, { upcomingFixedOre: upcomingFixed }) : null),
    [q.data, app.categories, period.from, period.to, today, upcomingFixed])

  // Samme tid forrige måned. Bare når du ser på en måned som har startet.
  const prevPeriod = app.period.mode === 'month' && today >= period.from ? previousComparablePeriod(period, today) : null
  const prevQ = useTransactions(prevPeriod ? app.householdId : undefined, prevPeriod ?? period)
  const prevMonthName = app.period.mode === 'month' ? monthLabel(monthOf(prevPeriod?.from ?? period.from)).split(' ')[0] : ''
  const cmp = useMemo(() => {
    if (!s || !prevPeriod || !prevQ.data) return null
    return compareWithPrevious(s, summarize(prevQ.data, app.categories, prevPeriod, today))
  }, [s, prevQ.data, app.categories, prevPeriod?.from, prevPeriod?.to, today])

  // Budsjett skaleres til perioden: et år er tolv måneder. Egen periode viser ikke budsjett.
  const factor = budgetFactor(app.period.mode)
  const budgetBy = useMemo(() => {
    const m = new Map<string, number>()
    if (!factor) return m
    for (const b of app.budgets) {
      const c = app.catById.get(b.category_id)
      if (c && !c.parent_id && !c.is_archived) m.set(b.category_id, b.amount_ore * factor)
    }
    return m
  }, [app.budgets, app.catById, factor])

  // Kategorier med budsjett vises også når ingenting er brukt ennå
  const catRows = useMemo(() => {
    if (!s) return []
    const rows = s.byCategory.map((c) => ({ ...c, budget: c.id ? budgetBy.get(c.id) ?? null : null }))
    for (const [id, budget] of budgetBy) {
      if (!rows.some((r) => r.id === id)) {
        const c = app.catById.get(id)!
        rows.push({ id, name: c.name, color: c.color, amountOre: 0, count: 0, children: [], budget })
      }
    }
    return rows
  }, [s, budgetBy, app.catById])

  const budgetTotal = [...budgetBy.values()].reduce((a, b) => a + b, 0)
  const budgetSpent = catRows.filter((c) => c.budget !== null).reduce((a, c) => a + Math.max(0, c.amountOre), 0)

  const periodWord = app.period.mode === 'month' ? `i ${monthLabel(app.period.month).split(' ')[0]}`
    : app.period.mode === 'year' ? `i ${app.period.year}` : 'i perioden'
  const ongoing = s && s.forecastSpendingOre !== null && s.spendingOre > 0

  return (
    <div className="mx-auto max-w-5xl px-4 md:px-8 pt-4 md:pt-8">
      <header className="flex items-center justify-between gap-2">
        <PeriodPicker />
      </header>

      {q.error && <p className="text-bad mt-6">Klarte ikke å hente transaksjoner. {(q.error as Error).message}</p>}
      {!s && !q.error && <p className="text-muted mt-10">Henter tall…</p>}

      {s && (
        <>
          <section aria-labelledby="hero" className="mt-6">
            <h1 id="hero" className="text-muted">Brukt {periodWord}</h1>
            <p className="num text-5xl md:text-6xl font-bold tracking-tight mt-1">{formatOre(s.spendingOre, { decimals: 'never' })}</p>
            <p className="text-muted mt-2">
              {s.incomeOre > 0
                ? <>Av <span className="num text-ink font-medium">{formatOre(s.incomeOre, { decimals: 'never' })}</span> registrert inntekt</>
                : 'Ingen inntekt registrert ennå'}
              {ongoing && <>. Med samme tempo blir det rundt <span className="num text-ink font-medium">{formatOre(s.forecastSpendingOre!, { decimals: 'never' })}</span> (anslag).</>}
            </p>
            {cmp && (cmp.previousOre > 0 || s.spendingOre > 0) && (
              <p className="text-sm mt-1.5">
                {cmp.deltaOre === 0 ? <span className="text-muted">Like mye som på samme tid i {prevMonthName}.</span> : (
                  <span className={cmp.deltaOre > 0 ? 'text-warn' : 'text-good'}>
                    <span className="num font-semibold">{formatOre(Math.abs(cmp.deltaOre), { decimals: 'never' })}</span>
                    {cmp.deltaOre > 0 ? ' mer' : ' mindre'} enn på samme tid i {prevMonthName}
                  </span>
                )}
              </p>
            )}
            <MonthStrip txs={q.data!} period={period} today={today} />
          </section>

          <div className="mt-8 grid gap-8 md:grid-cols-[1fr_1.1fr]">
            <section aria-labelledby="nokkeltall">
              <h2 id="nokkeltall" className="font-bold text-lg mb-3">Nøkkeltall</h2>
              <dl className="divide-y divide-line rounded-xl bg-surface px-4">
                <Stat label="Inntekter" value={formatOre(s.incomeOre)} tone="good" />
                <Stat label="Forbruk" value={formatOre(s.spendingOre)} hint="Utgifter, renter og gebyrer minus refusjoner" />
                {s.savingOre > 0 && <Stat label="Satt til sparing" value={formatOre(s.savingOre)} />}
                {s.loanPrincipalOre > 0 && <Stat label="Avdrag" value={formatOre(s.loanPrincipalOre)} />}
                <Stat label="Netto inn og ut" value={formatOre(s.netCashflowOre, { sign: true })} tone={s.netCashflowOre < 0 ? 'bad' : 'good'}
                  hint="Alt inn minus alt ut. Overføringer mellom egne kontoer teller ikke." />
                <Stat label="Snitt per dag" value={s.avgPerDayOre === null ? 'Ikke startet' : formatOre(s.avgPerDayOre, { decimals: 'never' })}
                  hint={s.daysElapsed > 0 ? `Over ${s.daysElapsed} av ${s.daysTotal} dager` : undefined} />
                {ongoing && <Stat label="Anslag for perioden" value={formatOre(s.forecastSpendingOre!, { decimals: 'never' })} hint="Variabelt forbruk i samme tempo, pluss faste poster" />}
                {s.upcomingFixedOre > 0 && <Stat label="Faste utgifter som gjenstår" value={formatOre(s.upcomingFixedOre)} hint="Registreres automatisk på dagen" />}
              </dl>
              <SubscriptionCard />
            </section>

            <section aria-labelledby="kategorier">
              <div className="flex items-baseline justify-between mb-3">
                <h2 id="kategorier" className="font-bold text-lg">Forbruk per kategori</h2>
                <Link to="/budsjett" className="text-sm font-semibold text-accent">{app.budgets.length ? 'Endre budsjett' : 'Sett budsjett'}</Link>
              </div>
              {budgetTotal > 0 && (
                <BudgetBar spent={budgetSpent} budget={budgetTotal} status={budgetStatus(budgetSpent, budgetTotal, s.daysElapsed, s.daysTotal)} />
              )}
              {catRows.length === 0 ? (
                <p className="text-muted rounded-xl bg-surface p-4">Ingen forbruk {periodWord} ennå.</p>
              ) : (
                <ul className="rounded-xl bg-surface p-2">
                  {catRows.map((c) => {
                    // Med budsjett viser streken hvor mye av budsjettet som er brukt, ellers andelen av forbruket
                    const pct = c.budget ? Math.min(1, Math.max(0, c.amountOre / c.budget))
                      : s.spendingOre > 0 ? Math.max(0, c.amountOre / s.spendingOre) : 0
                    const status = c.budget ? budgetStatus(c.amountOre, c.budget, s.daysElapsed, s.daysTotal) : null
                    const delta = cmp?.byCategory.get(c.id) ?? 0
                    return (
                      <li key={c.id ?? 'none'}>
                        <button className="w-full text-left rounded-lg px-2 py-2.5 hover:bg-sunken"
                          onClick={() => navigate(`/transaksjoner?kategori=${c.id ?? 'ingen'}`)}
                          aria-label={`${c.name}: ${formatOre(c.amountOre)}${c.budget ? ` av ${formatOre(c.budget)}` : ''}, ${Math.round(pct * 100)} prosent. Vis transaksjoner.`}>
                          <span className="flex justify-between gap-3">
                            <span className="font-medium truncate">{c.name}</span>
                            <span className="num font-semibold whitespace-nowrap">
                              {formatOre(c.amountOre, { decimals: 'never' })}
                              {c.budget && <span className="font-normal text-muted"> av {formatOre(c.budget, { decimals: 'never' })}</span>}
                            </span>
                          </span>
                          <span className="mt-1.5 flex items-center gap-2">
                            <span className="h-1.5 flex-1 rounded-full bg-sunken overflow-hidden">
                              <span className="block h-full rounded-full" style={{ width: `${pct * 100}%`, background: status ? STATUS_COLOR[status] : c.color ?? 'var(--muted)' }} />
                            </span>
                            <span className="num text-xs text-muted w-9 text-right">{Math.round(pct * 100)} %</span>
                          </span>
                          {(status && status !== 'ok') || (cmp && delta !== 0) ? (
                            <span className="mt-1 flex justify-between gap-3 text-xs">
                              <span className={status === 'over' ? 'text-bad' : 'text-warn'}>
                                {status === 'over' ? `${formatOre(c.amountOre - c.budget!, { decimals: 'never' })} over budsjett`
                                  : status === 'warn' ? 'Ligger an til å gå over' : ''}
                              </span>
                              {cmp && delta !== 0 && (
                                <span className="text-muted num">{delta > 0 ? '+' : '−'}{formatOre(Math.abs(delta), { decimals: 'never' })} mot {prevMonthName}</span>
                              )}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>

          <section aria-labelledby="siste" className="mt-8">
            <div className="flex items-baseline justify-between mb-2">
              <h2 id="siste" className="font-bold text-lg">Siste transaksjoner</h2>
              {q.data!.length > 0 && <Link to="/transaksjoner" className="text-sm font-semibold text-accent">Se alle</Link>}
            </div>
            {q.data!.length === 0 ? (
              <div className="rounded-xl bg-surface p-6 text-center">
                <p className="text-muted mb-4">Ingenting registrert {periodWord}.</p>
                <button className="btn btn-primary" onClick={() => app.setQuickOpen(true)}>Registrer første kjøp</button>
              </div>
            ) : (
              <div className="rounded-xl bg-surface px-3 py-1">
                {q.data!.slice(0, 6).map((tx) => <TxRow key={tx.id} tx={tx} />)}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt>
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted mt-0.5">{hint}</span>}
      </dt>
      <dd className={`num font-semibold whitespace-nowrap ${tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : ''}`}>{value}</dd>
    </div>
  )
}

const STATUS_COLOR: Record<BudgetStatus, string> = { ok: 'var(--good)', warn: 'var(--warn)', over: 'var(--bad)' }

function BudgetBar({ spent, budget, status }: { spent: number; budget: number; status: BudgetStatus }) {
  const pct = Math.min(1, spent / budget)
  const left = budget - spent
  return (
    <div className="rounded-xl bg-surface p-4 mb-3">
      <div className="flex justify-between gap-3 text-sm">
        <span>Budsjett</span>
        <span className="num"><span className="font-semibold">{formatOre(spent, { decimals: 'never' })}</span> av {formatOre(budget, { decimals: 'never' })}</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-sunken overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: STATUS_COLOR[status] }} />
      </div>
      <p className={`mt-2 text-sm ${status === 'over' ? 'text-bad' : status === 'warn' ? 'text-warn' : 'text-muted'}`}>
        {left >= 0 ? `${formatOre(left, { decimals: 'never' })} igjen` : `${formatOre(-left, { decimals: 'never' })} over`}
        {status === 'warn' && '. Med samme tempo går du over.'}
      </p>
    </div>
  )
}

/** Kort som viser hva faste trekk koster, med lenke til abonnementsjegeren */
function SubscriptionCard() {
  const s = useSubscriptions()
  if (!s.subs) return null
  const count = s.subsCount
  const pricier = s.subs.filter((x) => x.status === 'active' && x.priceChange && x.priceChange.toOre > x.priceChange.fromOre).length
  return (
    <Link to="/abonnementer" className="mt-3 flex items-center gap-3 rounded-xl bg-surface px-4 py-3 hover:bg-sunken">
      <span className="flex-1 min-w-0">
        <span className="block font-medium">Abonnementer</span>
        <span className="block text-sm text-muted truncate">
          {count === 0 ? 'Se hva som trekkes jevnlig'
            : <>{count} stk · <span className="num">{formatOre(s.subsMonthlyOre * 12, { decimals: 'never' })}</span> i året</>}
          {pricier > 0 && <span className="text-warn"> · {pricier} har blitt dyrere</span>}
        </span>
      </span>
      {count > 0 && <span className="num font-semibold whitespace-nowrap">{formatOre(s.subsMonthlyOre, { decimals: 'never' })}<span className="text-muted font-normal text-sm">/mnd</span></span>}
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="text-muted shrink-0"><path d="M7 4l5 5-5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </Link>
  )
}
