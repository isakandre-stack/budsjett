import { describe, expect, it } from 'vitest'
import { accountBalances, type BalanceTx } from '../../src/lib/balance'

const acc = (id: string, kr: number | null, on: string | null = '2026-11-01') => ({ id, opening_balance_ore: kr === null ? null : kr * 100, opening_balance_on: kr === null ? null : on })
const tx = (kind: BalanceTx['kind'], kr: number, date: string, account_id: string | null, to_account_id: string | null = null): BalanceTx =>
  ({ kind, amount_ore: kr * 100, occurred_on: date, account_id, to_account_id })

describe('saldo per konto', () => {
  it('startsaldo pluss inn minus ut', () => {
    const b = accountBalances([acc('bruk', 10000)], [
      tx('income', 30000, '2026-11-20', 'bruk'), tx('expense', 500, '2026-11-02', 'bruk'),
      tx('refund', 100, '2026-11-03', 'bruk'), tx('saving', 2000, '2026-11-05', 'bruk'),
    ], '2026-11-30')
    expect(b.get('bruk')).toBe((10000 + 30000 - 500 + 100 - 2000) * 100)
  })

  it('overføring flytter penger mellom kontoer, og nedbetaling av kortet minsker gjelden', () => {
    const b = accountBalances([acc('bruk', 10000), acc('kort', -3000)], [
      tx('expense', 1000, '2026-11-02', 'kort'),
      tx('transfer', 4000, '2026-11-10', 'bruk', 'kort'),
    ], '2026-11-30')
    expect(b.get('bruk')).toBe(6000 * 100)
    expect(b.get('kort')).toBe(0)
  })

  it('teller ikke det som er før startdatoen eller fram i tid', () => {
    const b = accountBalances([acc('bruk', 1000)], [
      tx('expense', 50, '2026-10-31', 'bruk'), tx('expense', 70, '2026-12-01', 'bruk'), tx('expense', 10, '2026-11-01', 'bruk'),
    ], '2026-11-15')
    expect(b.get('bruk')).toBe(99000)
  })

  it('kontoer uten startsaldo og transaksjoner uten konto får ingen saldo', () => {
    const b = accountBalances([acc('spar', null)], [tx('expense', 10, '2026-11-02', null)], '2026-11-15')
    expect(b.size).toBe(0)
  })
})
