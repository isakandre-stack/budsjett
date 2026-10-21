// Datoer behandles som rene kalenderdatoer (YYYY-MM-DD) i norsk tid.
// Vi regner aldri med tidssoner etter at datoen er bestemt.

const TZ = 'Europe/Oslo'

/** Dagens dato i Norge som YYYY-MM-DD, uavhengig av maskinens tidssone. */
export function todayISO(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export interface Month {
  year: number
  /** 1 til 12 */
  month: number
}

export function monthOf(iso: string): Month {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) }
}

export function daysInMonth({ year, month }: Month): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function shiftMonth({ year, month }: Month, delta: number): Month {
  const idx = year * 12 + (month - 1) + delta
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

const pad = (n: number) => String(n).padStart(2, '0')

export interface Period {
  from: string
  to: string
}

export function monthPeriod(m: Month): Period {
  return { from: `${m.year}-${pad(m.month)}-01`, to: `${m.year}-${pad(m.month)}-${pad(daysInMonth(m))}` }
}

export function yearPeriod(year: number): Period {
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

/** Antall dager i perioden, begge ender inkludert. */
export function daysBetweenInclusive(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((b - a) / 86_400_000) + 1
}

const MONTHS = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember']

export function monthLabel(m: Month): string {
  return `${MONTHS[m.month - 1]} ${m.year}`
}

export function formatDate(iso: string, today = todayISO()): string {
  if (iso === today) return 'I dag'
  const y = shiftDay(today, -1)
  if (iso === y) return 'I går'
  const d = +iso.slice(8, 10)
  const m = MONTHS[+iso.slice(5, 7) - 1].slice(0, 3)
  return iso.slice(0, 4) === today.slice(0, 4) ? `${d}. ${m}` : `${d}. ${m} ${iso.slice(0, 4)}`
}

export function shiftDay(iso: string, delta: number): string {
  const t = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + delta))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}
