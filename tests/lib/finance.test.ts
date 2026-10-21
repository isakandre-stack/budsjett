import { describe, expect, it } from 'vitest'
import { daysInMonth, monthPeriod, shiftMonth, todayISO, yearPeriod, formatDate } from '../../src/lib/dates'
import { summarize, suggestCategory, type CategoryLike, type TxLike, type TxKind } from '../../src/lib/finance'

const cats: CategoryLike[] = [
  { id: 'mat', parent_id: null, name: 'Mat og dagligvarer', color: '#22c55e' },
  { id: 'dagligvarer', parent_id: 'mat', name: 'Dagligvarer', color: '#22c55e' },
  { id: 'kiosk', parent_id: 'mat', name: 'Kiosk', color: '#22c55e' },
  { id: 'shopping', parent_id: null, name: 'Shopping', color: '#ec4899' },
  { id: 'lonn', parent_id: null, name: 'Lønn', color: '#16a34a' },
]

let n = 0
function tx(kind: TxKind, amount: number, date: string, category: string | null = null, splits?: [string | null, number][]): TxLike {
  return {
    id: `t${++n}`,
    kind,
    amount_ore: amount,
    occurred_on: date,
    category_id: category,
    transaction_splits: splits?.map(([c, a]) => ({ category_id: c, amount_ore: a })),
  }
}

const oct = monthPeriod({ year: 2026, month: 10 })

describe('summarize', () => {
  it('overføringer er verken inntekt, forbruk eller netto', () => {
    const s = summarize([tx('transfer', 500000, '2026-10-05')], cats, oct, '2026-10-31')
    expect(s.incomeOre).toBe(0)
    expect(s.spendingOre).toBe(0)
    expect(s.netCashflowOre).toBe(0)
    expect(s.byCategory).toEqual([])
  })

  it('refusjon reduserer forbruket i riktig kategori', () => {
    const s = summarize([
      tx('expense', 100000, '2026-10-02', 'shopping'),
      tx('refund', 40000, '2026-10-09', 'shopping'),
    ], cats, oct, '2026-10-31')
    expect(s.spendingOre).toBe(60000)
    expect(s.byCategory).toHaveLength(1)
    expect(s.byCategory[0]).toMatchObject({ id: 'shopping', amountOre: 60000, count: 2 })
    expect(s.netCashflowOre).toBe(-60000)
  })

  it('sparing og avdrag er ikke forbruk, men trekker fra netto. Låneopptak er ikke inntekt.', () => {
    const s = summarize([
      tx('income', 3000000, '2026-10-15', 'lonn'),
      tx('saving', 500000, '2026-10-15'),
      tx('loan_principal', 400000, '2026-10-20'),
      tx('interest_fee', 300000, '2026-10-20'),
      tx('loan_drawdown', 10000000, '2026-10-21'),
    ], cats, oct, '2026-10-31')
    expect(s.incomeOre).toBe(3000000)
    expect(s.spendingOre).toBe(300000)
    expect(s.savingOre).toBe(500000)
    expect(s.loanPrincipalOre).toBe(400000)
    expect(s.loanDrawdownOre).toBe(10000000)
    expect(s.netCashflowOre).toBe(3000000 - 500000 - 400000 - 300000 + 10000000)
  })

  it('splitt teller beløpet én gang, fordelt på kategorier og samlet under hovedkategori', () => {
    const s = summarize([
      tx('expense', 30000, '2026-10-10', 'dagligvarer', [['dagligvarer', 20000], ['shopping', 10000]]),
      tx('expense', 5000, '2026-10-11', 'kiosk'),
    ], cats, oct, '2026-10-31')
    expect(s.spendingOre).toBe(35000)
    const sum = s.byCategory.reduce((a, c) => a + c.amountOre, 0)
    expect(sum).toBe(s.spendingOre)
    const mat = s.byCategory.find((c) => c.id === 'mat')!
    expect(mat.amountOre).toBe(25000)
    expect(mat.children).toEqual([
      { id: 'dagligvarer', name: 'Dagligvarer', amountOre: 20000 },
      { id: 'kiosk', name: 'Kiosk', amountOre: 5000 },
    ])
    expect(s.byCategory.find((c) => c.id === 'shopping')!.amountOre).toBe(10000)
  })

  it('ukategorisert forbruk havner i egen gruppe', () => {
    const s = summarize([tx('expense', 1234, '2026-10-01')], cats, oct, '2026-10-31')
    expect(s.byCategory[0]).toMatchObject({ id: null, name: 'Ukategorisert', amountOre: 1234 })
  })

  it('tar bare med transaksjoner i perioden, inkludert første og siste dag', () => {
    const s = summarize([
      tx('expense', 1, '2026-09-30'),
      tx('expense', 10, '2026-10-01'),
      tx('expense', 100, '2026-10-31'),
      tx('expense', 1000, '2026-11-01'),
    ], cats, oct, '2026-11-15')
    expect(s.spendingOre).toBe(110)
    expect(s.transactionCount).toBe(2)
  })

  it('snitt per dag og prognose for pågående måned', () => {
    const s = summarize([tx('expense', 100000, '2026-10-03')], cats, oct, '2026-10-10')
    expect(s.daysElapsed).toBe(10)
    expect(s.daysTotal).toBe(31)
    expect(s.avgPerDayOre).toBe(10000)
    expect(s.forecastSpendingOre).toBe(310000)
  })

  it('ingen prognose for avsluttet eller fremtidig måned', () => {
    const past = summarize([tx('expense', 31000, '2026-10-03')], cats, oct, '2026-11-02')
    expect(past.forecastSpendingOre).toBeNull()
    expect(past.avgPerDayOre).toBe(1000)
    const future = summarize([], cats, oct, '2026-09-20')
    expect(future.avgPerDayOre).toBeNull()
    expect(future.forecastSpendingOre).toBeNull()
  })

  it('avrunder snitt til hele øre', () => {
    const s = summarize([tx('expense', 100, '2026-10-01')], cats, oct, '2026-10-03')
    expect(s.avgPerDayOre).toBe(33)
    expect(Number.isInteger(s.forecastSpendingOre)).toBe(true)
  })

  it('sletting og endring gir riktige tall (summen bygges alltid fra transaksjonene)', () => {
    const list = [tx('expense', 5000, '2026-10-01', 'kiosk'), tx('expense', 7000, '2026-10-02', 'kiosk')]
    expect(summarize(list, cats, oct, '2026-10-31').spendingOre).toBe(12000)
    const edited = [{ ...list[0], amount_ore: 6000 }]
    expect(summarize(edited, cats, oct, '2026-10-31').spendingOre).toBe(6000)
  })
})

describe('datoer', () => {
  it('månedsskifte og skuddår', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 })
    expect(shiftMonth({ year: 2026, month: 3 }, -14)).toEqual({ year: 2025, month: 1 })
    expect(daysInMonth({ year: 2028, month: 2 })).toBe(29)
    expect(daysInMonth({ year: 2026, month: 2 })).toBe(28)
    expect(monthPeriod({ year: 2026, month: 2 })).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(yearPeriod(2026)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('dagens dato følger norsk tid, ikke UTC', () => {
    // 23:30 UTC 31. okt er 00:30 1. nov i Norge (vintertid)
    expect(todayISO(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01')
    // 22:30 UTC 30. juni er 00:30 1. juli i Norge (sommertid)
    expect(todayISO(new Date('2026-06-30T22:30:00Z'))).toBe('2026-07-01')
  })

  it('viser I dag og I går', () => {
    expect(formatDate('2026-10-21', '2026-10-21')).toBe('I dag')
    expect(formatDate('2026-10-20', '2026-10-21')).toBe('I går')
    expect(formatDate('2026-10-01', '2026-10-21')).toBe('1. okt')
    expect(formatDate('2025-12-24', '2026-10-21')).toBe('24. des 2025')
  })
})

describe('suggestCategory', () => {
  const merchants = [
    { normalized_name: 'rema 1000', default_category_id: 'dagligvarer', use_count: 12 },
    { normalized_name: 'rema 1000 bryn', default_category_id: 'kiosk', use_count: 1 },
    { normalized_name: 'narvesen', default_category_id: 'kiosk', use_count: 4 },
  ]
  it('eksakt treff først, så prefiks etter hyppighet', () => {
    expect(suggestCategory('REMA 1000', merchants)).toBe('dagligvarer')
    expect(suggestCategory('rema', merchants)).toBe('dagligvarer')
    expect(suggestCategory('Narv', merchants)).toBe('kiosk')
    expect(suggestCategory('rema 1000 lillestrøm', merchants)).toBe('dagligvarer')
    expect(suggestCategory('Elkjøp', merchants)).toBeNull()
    expect(suggestCategory('', merchants)).toBeNull()
  })
})
