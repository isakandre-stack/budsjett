// All økonomisk logikk for oppsummeringer samlet på ett sted, så den kan testes.
import { daysBetweenInclusive, daysInMonth, monthOf, shiftDay, shiftMonth, type Period } from './dates'

export type TxKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'saving'
  | 'loan_drawdown'
  | 'loan_principal'
  | 'interest_fee'
  | 'refund'

export const KIND_LABEL: Record<TxKind, string> = {
  expense: 'Utgift',
  income: 'Inntekt',
  transfer: 'Overføring',
  saving: 'Sparing',
  loan_drawdown: 'Låneopptak',
  loan_principal: 'Avdrag',
  interest_fee: 'Renter og gebyrer',
  refund: 'Refusjon',
}

/**
 * Hvordan hver type påvirker tallene.
 * spending: +1 øker forbruket, -1 reduserer det (refusjon), 0 påvirker ikke.
 * cash:     +1 penger inn, -1 penger ut, 0 flytting mellom egne kontoer.
 */
export const KIND_EFFECT: Record<TxKind, { spending: -1 | 0 | 1; cash: -1 | 0 | 1 }> = {
  expense: { spending: 1, cash: -1 },
  interest_fee: { spending: 1, cash: -1 },
  refund: { spending: -1, cash: 1 },
  income: { spending: 0, cash: 1 },
  loan_drawdown: { spending: 0, cash: 1 },
  saving: { spending: 0, cash: -1 },
  loan_principal: { spending: 0, cash: -1 },
  transfer: { spending: 0, cash: 0 },
}

export interface SplitLike {
  category_id: string | null
  amount_ore: number
}

export interface TxLike {
  id: string
  kind: TxKind
  amount_ore: number
  occurred_on: string
  category_id: string | null
  transaction_splits?: SplitLike[] | null
  /** Satt når transaksjonen er registrert automatisk fra en fast post */
  recurring_id?: string | null
}

export interface CategoryLike {
  id: string
  parent_id: string | null
  name: string
  color: string | null
}

/** Fordeler en transaksjon på kategorier. Splitt brukes når de finnes, ellers hovedkategorien. */
export function categoryLines(tx: TxLike): SplitLike[] {
  if (tx.transaction_splits && tx.transaction_splits.length > 0) return tx.transaction_splits
  return [{ category_id: tx.category_id, amount_ore: tx.amount_ore }]
}

/**
 * Lager et filter for kategorilinjer. "ingen" betyr ukategorisert. En hovedkategori
 * omfatter også underkategoriene sine, akkurat som i oversikten.
 */
export function categoryLineFilter(filter: string, categories: CategoryLike[]): (line: SplitLike) => boolean {
  const byId = new Map(categories.map((c) => [c.id, c]))
  if (filter === 'ingen') return (l) => !l.category_id || !byId.has(l.category_id)
  return (l) => {
    if (!l.category_id) return false
    return l.category_id === filter || byId.get(l.category_id)?.parent_id === filter
  }
}

/**
 * Forbruket en transaksjon står for. Med filter teller bare linjene som passer,
 * så et delt kjøp bare bidrar med sin del i kategorien du ser på.
 */
export function txSpending(tx: TxLike, lineFilter?: (line: SplitLike) => boolean): number {
  const eff = KIND_EFFECT[tx.kind].spending
  if (eff === 0) return 0
  const lines = lineFilter ? categoryLines(tx).filter(lineFilter) : categoryLines(tx)
  return eff * lines.reduce((sum, l) => sum + l.amount_ore, 0)
}

export interface CategoryTotal {
  /** Hovedkategori, eller null for ukategorisert */
  id: string | null
  name: string
  color: string | null
  amountOre: number
  count: number
  children: { id: string; name: string; amountOre: number }[]
}

export interface Summary {
  incomeOre: number
  /** Utgifter + renter/gebyrer minus refusjoner */
  spendingOre: number
  savingOre: number
  loanPrincipalOre: number
  loanDrawdownOre: number
  /** Alt inn minus alt ut. Overføringer mellom egne kontoer teller ikke. */
  netCashflowOre: number
  /** Dager i perioden som har passert, inkludert i dag */
  daysElapsed: number
  daysTotal: number
  /** Gjennomsnittlig forbruk per passerte dag. null hvis perioden ikke har startet. */
  avgPerDayOre: number | null
  /** Anslag for hele perioden basert på tempoet så langt. Bare for pågående periode. */
  forecastSpendingOre: number | null
  /** Forbruk fra faste poster som er registrert i perioden */
  fixedSpendingOre: number
  /** Faste utgifter som kommer senere i perioden, men ikke er registrert ennå */
  upcomingFixedOre: number
  byCategory: CategoryTotal[]
  transactionCount: number
}

export function summarize(
  txs: TxLike[],
  categories: CategoryLike[],
  period: Period,
  today: string,
  opts: { upcomingFixedOre?: number } = {},
): Summary {
  const upcomingFixed = opts.upcomingFixedOre ?? 0
  const inPeriod = txs.filter((t) => t.occurred_on >= period.from && t.occurred_on <= period.to)

  let income = 0
  let spending = 0
  let saving = 0
  let principal = 0
  let drawdown = 0
  let net = 0
  // Forbruk som er ført på en dato som ikke har kommet ennå, for eksempel husleie lagt inn på forhånd
  let futureSpending = 0
  // Faste poster (husleie, abonnementer) kommer én gang i måneden og sier ingenting om tempoet
  let fixedSpending = 0

  const catById = new Map(categories.map((c) => [c.id, c]))
  const top = new Map<string | null, { amount: number; txIds: Set<string>; children: Map<string, number> }>()

  for (const t of inPeriod) {
    const eff = KIND_EFFECT[t.kind]
    net += eff.cash * t.amount_ore
    if (t.kind === 'income') income += t.amount_ore
    if (t.kind === 'saving') saving += t.amount_ore
    if (t.kind === 'loan_principal') principal += t.amount_ore
    if (t.kind === 'loan_drawdown') drawdown += t.amount_ore
    if (eff.spending === 0) continue

    spending += eff.spending * t.amount_ore
    if (t.recurring_id) fixedSpending += eff.spending * t.amount_ore
    else if (t.occurred_on > today) futureSpending += eff.spending * t.amount_ore
    for (const line of categoryLines(t)) {
      const cat = line.category_id ? catById.get(line.category_id) : undefined
      const topId = cat ? (cat.parent_id ?? cat.id) : null
      let bucket = top.get(topId)
      if (!bucket) {
        bucket = { amount: 0, txIds: new Set(), children: new Map() }
        top.set(topId, bucket)
      }
      const signed = eff.spending * line.amount_ore
      bucket.amount += signed
      bucket.txIds.add(t.id)
      if (cat && cat.parent_id) bucket.children.set(cat.id, (bucket.children.get(cat.id) ?? 0) + signed)
    }
  }

  const byCategory: CategoryTotal[] = [...top.entries()]
    .map(([id, b]) => {
      const c = id ? catById.get(id) : undefined
      return {
        id,
        name: c?.name ?? 'Ukategorisert',
        color: c?.color ?? null,
        amountOre: b.amount,
        count: b.txIds.size,
        children: [...b.children.entries()]
          .map(([cid, amt]) => ({ id: cid, name: catById.get(cid)?.name ?? '', amountOre: amt }))
          .sort((a, z) => z.amountOre - a.amountOre),
      }
    })
    .filter((c) => c.amountOre !== 0)
    .sort((a, z) => z.amountOre - a.amountOre)

  const daysTotal = daysBetweenInclusive(period.from, period.to)
  let daysElapsed: number
  if (today < period.from) daysElapsed = 0
  else if (today > period.to) daysElapsed = daysTotal
  else daysElapsed = daysBetweenInclusive(period.from, today)

  // Tempoet regnes bare av det variable forbruket som faktisk har skjedd til og med i dag.
  // Faste poster og forbruk ført fram i tid legges til anslaget én gang, i stedet for å
  // blåses opp som om det var dagens tempo.
  const variableSoFar = spending - futureSpending - fixedSpending
  const avgPerDayOre = daysElapsed > 0 ? Math.round((spending - futureSpending) / daysElapsed) : null
  const ongoing = daysElapsed > 0 && daysElapsed < daysTotal
  const forecastSpendingOre = ongoing
    ? Math.round((variableSoFar * daysTotal) / daysElapsed) + futureSpending + fixedSpending + upcomingFixed
    : null

  return {
    incomeOre: income,
    spendingOre: spending,
    savingOre: saving,
    loanPrincipalOre: principal,
    loanDrawdownOre: drawdown,
    netCashflowOre: net,
    daysElapsed,
    daysTotal,
    avgPerDayOre,
    forecastSpendingOre,
    fixedSpendingOre: fixedSpending,
    upcomingFixedOre: ongoing ? upcomingFixed : 0,
    byCategory,
    transactionCount: inPeriod.length,
  }
}

/** Foreslår kategori ut fra hva du har brukt hos samme butikk før. */
export function suggestCategory(
  merchantText: string,
  merchants: { normalized_name: string; default_category_id: string | null; use_count: number }[],
): string | null {
  const q = merchantText.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!q) return null
  const exact = merchants.find((m) => m.normalized_name === q && m.default_category_id)
  if (exact) return exact.default_category_id
  const prefix = merchants
    .filter((m) => m.default_category_id && (
      (q.length >= 2 && m.normalized_name.startsWith(q)) ||
      (m.normalized_name.length >= 3 && q.startsWith(m.normalized_name + ' '))))
    .sort((a, b) => b.use_count - a.use_count)[0]
  return prefix?.default_category_id ?? null
}

// ============================================================
// Faste poster
// ============================================================

export interface RecurringLike {
  id: string
  kind: TxKind
  amount_ore: number
  category_id: string | null
  day_of_month: number
  start_on: string
  end_on: string | null
  last_generated_on: string | null
  is_active: boolean
}

/** Datoen en fast post faller på i en gitt måned. 31 blir siste dag i korte måneder. */
export function recurringDateIn(r: Pick<RecurringLike, 'day_of_month'>, year: number, month: number): string {
  const day = Math.min(r.day_of_month, daysInMonth({ year, month }))
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Faste poster som kommer senere i perioden og ikke er registrert ennå. Samme regler som i databasen. */
export function upcomingRecurring<R extends RecurringLike>(list: R[], period: Period, today: string): { recurring: R; date: string }[] {
  const out: { recurring: R; date: string }[] = []
  for (const r of list) {
    if (!r.is_active) continue
    let m = monthOf(today > period.from ? today : period.from)
    const last = monthOf(period.to)
    for (let guard = 0; guard < 400 && (m.year < last.year || (m.year === last.year && m.month <= last.month)); guard++) {
      const d = recurringDateIn(r, m.year, m.month)
      const alreadyThisMonth = r.last_generated_on !== null && r.last_generated_on.slice(0, 7) >= d.slice(0, 7)
      if (d > today && d >= period.from && d <= period.to && d >= r.start_on && (!r.end_on || d <= r.end_on) && !alreadyThisMonth) {
        out.push({ recurring: r, date: d })
      }
      m = shiftMonth(m, 1)
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** Hvor mye kommende faste poster vil øke forbruket i perioden. */
export function upcomingFixedSpending(list: RecurringLike[], period: Period, today: string): number {
  return upcomingRecurring(list, period, today)
    .reduce((sum, o) => sum + KIND_EFFECT[o.recurring.kind].spending * o.recurring.amount_ore, 0)
}

// ============================================================
// Sammenligning med forrige måned
// ============================================================

/**
 * Samme punkt i forrige måned. Er vi på dag 21 i oktober, sammenlignes det med 1. til 21. september.
 * Er måneden ferdig, sammenlignes hele måneder. Finnes ikke dagen (31. i en kort måned), brukes siste dag.
 */
export function previousComparablePeriod(period: Period, today: string): Period {
  const cur = monthOf(period.from)
  const prev = shiftMonth(cur, -1)
  const prevFrom = `${prev.year}-${String(prev.month).padStart(2, '0')}-01`
  const prevDays = daysInMonth(prev)
  let day: number
  if (today >= period.to) day = prevDays
  else if (today < period.from) day = 0
  else day = Math.min(daysBetweenInclusive(period.from, today), prevDays)
  return { from: prevFrom, to: day === 0 ? shiftDay(prevFrom, -1) : shiftDay(prevFrom, day - 1) }
}

export interface Comparison {
  /** Forbruk så langt i år minus forbruk på samme tid forrige måned. Positivt betyr mer i år. */
  deltaOre: number
  previousOre: number
  /** Endring per hovedkategori (null er ukategorisert) */
  byCategory: Map<string | null, number>
}

export function compareWithPrevious(current: Summary, previous: Summary): Comparison {
  const byCategory = new Map<string | null, number>()
  for (const c of current.byCategory) byCategory.set(c.id, c.amountOre)
  for (const c of previous.byCategory) byCategory.set(c.id, (byCategory.get(c.id) ?? 0) - c.amountOre)
  return { deltaOre: current.spendingOre - previous.spendingOre, previousOre: previous.spendingOre, byCategory }
}

// ============================================================
// Budsjett
// ============================================================

/** Hvor mange måneder perioden tilsvarer, for å skalere månedsbudsjett. null betyr at budsjett ikke vises. */
export function budgetFactor(mode: 'month' | 'year' | 'custom'): number | null {
  if (mode === 'month') return 1
  if (mode === 'year') return 12
  return null
}

export type BudgetStatus = 'ok' | 'warn' | 'over'

/** Over budsjett, på vei over (med samme tempo), eller innenfor. */
export function budgetStatus(spentOre: number, budgetOre: number, daysElapsed: number, daysTotal: number): BudgetStatus {
  if (spentOre > budgetOre) return 'over'
  if (daysElapsed > 0 && daysElapsed < daysTotal && (spentOre * daysTotal) / daysElapsed > budgetOre) return 'warn'
  return 'ok'
}
