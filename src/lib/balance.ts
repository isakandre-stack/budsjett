// Saldo per konto: startsaldo pluss alt som er ført på kontoen fra og med startdatoen, til og med i dag.
import { KIND_EFFECT, type TxKind } from './finance'

export interface BalanceAccount {
  id: string
  opening_balance_ore: number | null
  opening_balance_on: string | null
}

export interface BalanceTx {
  kind: TxKind
  amount_ore: number
  occurred_on: string
  account_id: string | null
  to_account_id: string | null
}

/** Saldo for kontoene som har startsaldo. Overføringer trekkes fra den ene kontoen og legges til den andre. */
export function accountBalances(accounts: BalanceAccount[], txs: BalanceTx[], today: string): Map<string, number> {
  const out = new Map<string, number>()
  const since = new Map<string, string>()
  for (const a of accounts) {
    if (a.opening_balance_ore === null || !a.opening_balance_on) continue
    out.set(a.id, a.opening_balance_ore)
    since.set(a.id, a.opening_balance_on)
  }
  const add = (id: string | null, amount: number, date: string) => {
    if (!id || !out.has(id) || date < since.get(id)! || date > today) return
    out.set(id, out.get(id)! + amount)
  }
  for (const t of txs) {
    if (t.kind === 'transfer') {
      add(t.account_id, -t.amount_ore, t.occurred_on)
      add(t.to_account_id, t.amount_ore, t.occurred_on)
    } else {
      add(t.account_id, KIND_EFFECT[t.kind].cash * t.amount_ore, t.occurred_on)
    }
  }
  return out
}
