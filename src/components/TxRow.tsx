import { useApp } from '../app/AppContext'
import type { Transaction } from '../lib/api'
import { KIND_EFFECT, KIND_LABEL } from '../lib/finance'
import { formatOre } from '../lib/money'
import { categoryColor, categoryPath } from './CategorySelect'

export function txTitle(tx: Transaction, merchantName?: string): string {
  return merchantName || tx.description || KIND_LABEL[tx.kind]
}

export function TxRow({ tx }: { tx: Transaction }) {
  const { catById, merchantById, setEditor, accounts } = useApp()
  const cat = tx.category_id ? catById.get(tx.category_id) : undefined
  const split = tx.transaction_splits.length > 0
  const eff = KIND_EFFECT[tx.kind]
  const title = txTitle(tx, tx.merchant_id ? merchantById.get(tx.merchant_id)?.name : undefined)

  let sub: string
  if (tx.kind === 'transfer') {
    const a = accounts.find((x) => x.id === tx.account_id)?.name ?? '?'
    const b = accounts.find((x) => x.id === tx.to_account_id)?.name ?? '?'
    sub = `Overføring fra ${a} til ${b}`
  } else if (split) {
    sub = `Delt på ${tx.transaction_splits.length} kategorier`
  } else {
    sub = cat ? categoryPath(cat, catById) : tx.kind === 'expense' ? 'Ukategorisert' : KIND_LABEL[tx.kind]
    if (cat && tx.kind !== 'expense' && tx.kind !== 'income') sub = `${KIND_LABEL[tx.kind]}, ${sub}`
  }

  const positive = eff.cash > 0
  const neutral = eff.cash === 0

  return (
    <button onClick={() => setEditor({ type: 'edit', tx })}
      className="w-full flex items-center gap-3 px-1 py-2.5 text-left rounded-lg hover:bg-sunken focus-visible:bg-sunken">
      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: split ? 'var(--muted)' : categoryColor(cat, catById) }} />
      <span className="flex-1 min-w-0">
        <span className="block truncate font-medium">{title}</span>
        <span className="block truncate text-sm text-muted">{sub}</span>
      </span>
      <span className={`num font-semibold whitespace-nowrap ${positive ? 'text-good' : neutral ? 'text-muted' : ''}`}>
        {positive ? '+' : neutral ? '' : '−'}{formatOre(tx.amount_ore)}
      </span>
    </button>
  )
}
