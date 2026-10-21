import type { Transaction } from '../lib/api'
import { daysBetweenInclusive, shiftDay, type Period } from '../lib/dates'
import { KIND_EFFECT } from '../lib/finance'
import { formatOre } from '../lib/money'

/**
 * Dag-for-dag-stripe over perioden: én søyle per dag med forbruket den dagen.
 * Dager som ikke har kommet ennå vises som svake streker.
 */
export function MonthStrip({ txs, period, today }: { txs: Transaction[]; period: Period; today: string }) {
  const days = daysBetweenInclusive(period.from, period.to)
  if (days > 62) return null

  const perDay = new Map<string, number>()
  for (const t of txs) {
    const s = KIND_EFFECT[t.kind].spending
    if (s === 0) continue
    perDay.set(t.occurred_on, (perDay.get(t.occurred_on) ?? 0) + s * t.amount_ore)
  }
  const values = Array.from({ length: days }, (_, i) => {
    const d = shiftDay(period.from, i)
    return { d, v: Math.max(0, perDay.get(d) ?? 0) }
  })
  const max = Math.max(1, ...values.map((x) => x.v))
  const W = 100 / days
  const H = 56
  const biggest = values.reduce((a, b) => (b.v > a.v ? b : a), values[0])

  return (
    <figure className="mt-6">
      <svg viewBox={`0 0 100 ${H + 6}`} preserveAspectRatio="none" className="w-full h-20" role="img"
        aria-label={`Forbruk per dag. Største dag: ${biggest.v > 0 ? `${+biggest.d.slice(8)}. med ${formatOre(biggest.v)}` : 'ingen forbruk ennå'}`}>
        {values.map(({ d, v }, i) => {
          const future = d > today
          const h = v > 0 ? Math.max(2, Math.sqrt(v / max) * H) : 1.2
          return (
            <g key={d}>
              <title>{`${+d.slice(8)}.${+d.slice(5, 7)}: ${formatOre(v)}`}</title>
              <rect x={i * W + W * 0.18} y={H - h} width={W * 0.64} height={h} rx={Math.min(0.6, W * 0.2)}
                fill={future ? 'var(--line)' : v > 0 ? 'var(--accent)' : 'var(--muted)'}
                opacity={future ? 0.6 : v > 0 ? 1 : 0.35} />
              {d === today && <rect x={i * W + W * 0.18} y={H + 2.5} width={W * 0.64} height={2} rx={1} fill="var(--warn)" />}
            </g>
          )
        })}
      </svg>
      <figcaption className="flex justify-between text-xs text-muted num mt-1">
        <span>{+period.from.slice(8)}.</span>
        <span>{+period.to.slice(8)}.</span>
      </figcaption>
    </figure>
  )
}
