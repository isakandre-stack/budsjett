// All økonomisk logikk for oppsummeringer samlet på ett sted, så den kan testes.
import { daysBetweenInclusive, type Period } from './dates'

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
  byCategory: CategoryTotal[]
  transactionCount: number
}

export function summarize(
  txs: TxLike[],
  categories: CategoryLike[],
  period: Period,
  today: string,
): Summary {
  const inPeriod = txs.filter((t) => t.occurred_on >= period.from && t.occurred_on <= period.to)

  let income = 0
  let spending = 0
  let saving = 0
  let principal = 0
  let drawdown = 0
  let net = 0

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

  const avgPerDayOre = daysElapsed > 0 ? Math.round(spending / daysElapsed) : null
  const ongoing = daysElapsed > 0 && daysElapsed < daysTotal
  const forecastSpendingOre = ongoing ? Math.round((spending * daysTotal) / daysElapsed) : null

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
