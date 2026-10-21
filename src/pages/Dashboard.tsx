import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { periodOf, useApp } from '../app/AppContext'
import { MonthStrip } from '../components/MonthStrip'
import { PeriodPicker } from '../components/PeriodPicker'
import { TxRow } from '../components/TxRow'
import { useTransactions } from '../lib/api'
import { monthLabel, todayISO } from '../lib/dates'
import { summarize } from '../lib/finance'
import { formatOre } from '../lib/money'

export function Dashboard() {
  const app = useApp()
  const period = periodOf(app.period)
  const today = todayISO()
  const q = useTransactions(app.householdId, period)
  const navigate = useNavigate()
  const s = useMemo(() => (q.data ? summarize(q.data, app.categories, period, today) : null), [q.data, app.categories, period.from, period.to, today])

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
                {ongoing && <Stat label="Anslag for perioden" value={formatOre(s.forecastSpendingOre!, { decimals: 'never' })} hint="Estimat basert på forbruket så langt" />}
              </dl>
            </section>

            <section aria-labelledby="kategorier">
              <h2 id="kategorier" className="font-bold text-lg mb-3">Forbruk per kategori</h2>
              {s.byCategory.length === 0 ? (
                <p className="text-muted rounded-xl bg-surface p-4">Ingen forbruk {periodWord} ennå.</p>
              ) : (
                <ul className="rounded-xl bg-surface p-2">
                  {s.byCategory.map((c) => {
                    const pct = s.spendingOre > 0 ? Math.max(0, c.amountOre / s.spendingOre) : 0
                    return (
                      <li key={c.id ?? 'none'}>
                        <button className="w-full text-left rounded-lg px-2 py-2.5 hover:bg-sunken"
                          onClick={() => navigate(`/transaksjoner?kategori=${c.id ?? 'ingen'}`)}
                          aria-label={`${c.name}: ${formatOre(c.amountOre)}, ${Math.round(pct * 100)} prosent. Vis transaksjoner.`}>
                          <span className="flex justify-between gap-3">
                            <span className="font-medium truncate">{c.name}</span>
                            <span className="num font-semibold">{formatOre(c.amountOre, { decimals: 'never' })}</span>
                          </span>
                          <span className="mt-1.5 flex items-center gap-2">
                            <span className="h-1.5 flex-1 rounded-full bg-sunken overflow-hidden">
                              <span className="block h-full rounded-full" style={{ width: `${pct * 100}%`, background: c.color ?? 'var(--muted)' }} />
                            </span>
                            <span className="num text-xs text-muted w-9 text-right">{Math.round(pct * 100)} %</span>
                          </span>
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
