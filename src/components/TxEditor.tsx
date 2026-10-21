import { useEffect, useState } from 'react'
import { useApp } from '../app/AppContext'
import { useDeleteTransaction, useSaveTransaction, type Split } from '../lib/api'
import { todayISO } from '../lib/dates'
import { KIND_LABEL, type TxKind } from '../lib/finance'
import { formatOre, oreToInput, parseAmountToOre } from '../lib/money'
import { errorMessage } from '../lib/supabase'
import { CategorySelect } from './CategorySelect'
import { Sheet } from './Sheet'
import { useToast } from './Toast'

const KINDS: TxKind[] = ['expense', 'income', 'refund', 'transfer', 'saving', 'loan_principal', 'interest_fee', 'loan_drawdown']

interface SplitRow { category_id: string | null; amount: string }

export function TxEditor() {
  const app = useApp()
  const { editor, setEditor, categories, accounts, merchantById, catById } = app
  const save = useSaveTransaction()
  const del = useDeleteTransaction()
  const toast = useToast()

  const existing = editor?.type === 'edit' ? editor.tx : null
  const draft = editor?.type === 'new' ? editor.draft : undefined

  const [kind, setKind] = useState<TxKind>('expense')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [merchant, setMerchant] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [toAccountId, setToAccountId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [tags, setTags] = useState('')
  const [refundOfId, setRefundOfId] = useState<string | null>(null)
  const [splitOn, setSplitOn] = useState(false)
  const [splits, setSplits] = useState<SplitRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!editor) return
    const src = existing ?? draft ?? {}
    setKind(src.kind ?? 'expense')
    setAmount(src.amount_ore ? oreToInput(src.amount_ore) : '')
    setDate(src.occurred_on ?? todayISO())
    setMerchant(
      existing ? (existing.merchant_id ? merchantById.get(existing.merchant_id)?.name ?? existing.description ?? '' : existing.description ?? '')
        : draft?.merchantName ?? '',
    )
    setCategoryId(src.category_id ?? null)
    // En eksisterende transaksjon beholder kontoen sin, også når den er uten konto.
    // Nye får standardkontoen, men aldri en arkivert konto.
    const def = app.defaultAccountId
    setAccountId(existing ? existing.account_id : draft?.account_id !== undefined ? draft.account_id : def)
    setToAccountId(src.to_account_id ?? null)
    setNote(src.note ?? '')
    setTags((src.tags ?? []).join(', '))
    setRefundOfId(src.refund_of_id ?? null)
    const s = (existing ?? draft)?.transaction_splits ?? []
    setSplitOn(s.length > 0)
    setSplits(s.map((x) => ({ category_id: x.category_id, amount: oreToInput(x.amount_ore) })))
    setError(null)
    setConfirmDelete(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  const amountOre = parseAmountToOre(amount)
  const splitOre = splits.map((s) => parseAmountToOre(s.amount))
  const splitSum = splitOre.reduce<number>((a, b) => a + (b ?? 0), 0)
  const splitRemaining = (amountOre ?? 0) - splitSum
  const catKind = kind === 'income' ? 'income' : 'expense'
  // Splitt finnes bare for utgift og refusjon. Bytter du til en annen type, skal skjulte splittlinjer ikke lagres.
  const canSplit = kind === 'expense' || kind === 'refund'
  const useSplit = splitOn && canSplit
  const activeAccounts = accounts.filter((a) => !a.is_archived || a.id === accountId || a.id === toAccountId)

  function validate(): string | null {
    if (!amountOre) return 'Skriv inn et gyldig beløp.'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Velg en dato.'
    if (kind === 'transfer' && (!accountId || !toAccountId)) return 'En overføring trenger både fra- og til-konto.'
    if (kind === 'transfer' && accountId === toAccountId) return 'Fra- og til-konto må være forskjellige.'
    if (useSplit) {
      if (splits.length < 2) return 'Splitt må ha minst to linjer.'
      if (splitOre.some((x) => x === null)) return 'Alle splittlinjer trenger et gyldig beløp.'
      if (splitRemaining !== 0) return `Splittene må bli ${formatOre(amountOre)} til sammen. Det mangler ${formatOre(splitRemaining)}.`
    }
    return null
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = validate()
    if (v) { setError(v); return }
    setError(null)
    const splitList: Split[] = useSplit ? splits.map((s, i) => ({ category_id: s.category_id, amount_ore: splitOre[i]! })) : []
    try {
      await save.mutateAsync({
        id: existing?.id ?? null,
        householdId: app.householdId,
        kind,
        amountOre: amountOre!,
        occurredOn: date,
        merchant,
        categoryId: useSplit ? (splits[0]?.category_id ?? null) : categoryId,
        accountId,
        toAccountId,
        note,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        refundOfId,
        splits: splitList,
      })
      setEditor(null)
      toast({ text: existing ? 'Endringene er lagret' : `Lagret ${formatOre(amountOre!)}` })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function remove() {
    if (!existing) return
    try {
      await del.mutateAsync(existing.id)
      setEditor(null)
      toast({ text: 'Transaksjonen er slettet' })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  function duplicate() {
    if (!existing) return
    setEditor({ type: 'new', draft: { ...existing, id: undefined, occurred_on: todayISO(), refund_of_id: null, merchantName: merchant } })
  }

  function refund() {
    if (!existing) return
    setEditor({
      type: 'new',
      draft: {
        kind: 'refund', amount_ore: existing.amount_ore, occurred_on: todayISO(), category_id: existing.category_id,
        account_id: existing.account_id, refund_of_id: existing.id, merchantName: merchant,
        // Et delt kjøp refunderes fordelt på de samme kategoriene
        transaction_splits: existing.transaction_splits.map(({ category_id, amount_ore }) => ({ category_id, amount_ore })),
      },
    })
  }

  function changeKind(k: TxKind) {
    setKind(k)
    // En utgiftskategori hører ikke hjemme på en inntekt, og omvendt
    const c = categoryId ? catById.get(categoryId) : undefined
    if (c && c.kind !== (k === 'income' ? 'income' : 'expense')) setCategoryId(null)
  }

  function toggleSplit() {
    if (!splitOn) {
      setSplits([
        { category_id: categoryId, amount: amountOre ? oreToInput(amountOre) : '' },
        { category_id: null, amount: '' },
      ])
    }
    setSplitOn(!splitOn)
  }

  const title = existing ? 'Endre transaksjon' : kind === 'refund' && refundOfId ? 'Registrer refusjon' : 'Ny transaksjon'

  return (
    <Sheet open={!!editor} onClose={() => setEditor(null)} title={title}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <label className="block col-span-2 sm:col-span-1">
            <span className="text-sm text-muted">Type</span>
            <select className="field mt-1" value={kind} onChange={(e) => changeKind(e.target.value as TxKind)}>
              {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="block col-span-2 sm:col-span-1">
            <span className="text-sm text-muted">Beløp</span>
            <input className="field mt-1 num text-lg font-semibold" inputMode="decimal" placeholder="0,00" autoFocus={!existing}
              value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!amount && !amountOre} />
          </label>
        </div>

        {refundOfId && kind === 'refund' && (
          <p className="text-sm rounded-lg bg-accent-soft px-3 py-2">Koblet til det opprinnelige kjøpet. Refusjonen trekkes fra forbruket i samme kategori.</p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm text-muted">Dato</span>
            <input type="date" className="field mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm text-muted">{kind === 'income' ? 'Fra' : 'Butikk'}</span>
            <input className="field mt-1" list="merchant-list" value={merchant} onChange={(e) => setMerchant(e.target.value)} autoComplete="off" />
            <datalist id="merchant-list">
              {app.merchants.slice(0, 200).map((m) => <option key={m.id} value={m.name} />)}
            </datalist>
          </label>
        </div>

        {!useSplit && (
          <label className="block">
            <span className="text-sm text-muted">Kategori</span>
            <div className="mt-1"><CategorySelect categories={categories} kind={catKind} value={categoryId} onChange={setCategoryId} /></div>
          </label>
        )}

        {canSplit && (
          <div>
            <button type="button" className="text-sm font-semibold text-accent underline underline-offset-2" onClick={toggleSplit}>
              {splitOn ? 'Bruk én kategori' : 'Del på flere kategorier'}
            </button>
            {splitOn && (
              <div className="mt-3 space-y-2">
                {splits.map((s, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <div className="flex-1 min-w-0">
                      <CategorySelect categories={categories} kind="expense" value={s.category_id}
                        onChange={(id) => setSplits(splits.map((x, j) => (j === i ? { ...x, category_id: id } : x)))} />
                    </div>
                    <input className="field num w-28" inputMode="decimal" placeholder="0" aria-label={`Beløp linje ${i + 1}`}
                      value={s.amount} onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                    <button type="button" className="btn btn-ghost px-2" aria-label={`Fjern linje ${i + 1}`} disabled={splits.length <= 2}
                      onClick={() => setSplits(splits.filter((_, j) => j !== i))}>
                      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between text-sm">
                  <button type="button" className="btn btn-ghost px-2" onClick={() => setSplits([...splits, { category_id: null, amount: splitRemaining > 0 ? oreToInput(splitRemaining) : '' }])}>
                    Legg til linje
                  </button>
                  <span className={`num ${splitRemaining === 0 ? 'text-good' : 'text-warn'}`}>
                    {splitRemaining === 0 ? 'Stemmer' : splitRemaining > 0 ? `${formatOre(splitRemaining)} igjen å fordele` : `${formatOre(-splitRemaining)} for mye`}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {activeAccounts.length > 1 && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm text-muted">{kind === 'transfer' ? 'Fra konto' : 'Konto'}</span>
              <select className="field mt-1" value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value || null)}>
                <option value="">Ingen</option>
                {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            {kind === 'transfer' && (
              <label className="block">
                <span className="text-sm text-muted">Til konto</span>
                <select className="field mt-1" value={toAccountId ?? ''} onChange={(e) => setToAccountId(e.target.value || null)}>
                  <option value="">Velg</option>
                  {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
        {kind === 'transfer' && activeAccounts.length < 2 && (
          <p className="text-sm text-warn">For å registrere en overføring må du ha minst to kontoer. Legg til en under Innstillinger.</p>
        )}

        <label className="block">
          <span className="text-sm text-muted">Notat</span>
          <textarea className="field mt-1" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm text-muted">Tags, skilt med komma</span>
          <input className="field mt-1" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="ferie, jobb" />
        </label>

        {error && <p role="alert" className="text-bad text-sm">{error}</p>}

        <button className="btn btn-primary w-full text-base" disabled={save.isPending}>{save.isPending ? 'Lagrer…' : existing ? 'Lagre endringer' : 'Lagre'}</button>

        {existing && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-line">
            <button type="button" className="btn btn-ghost" onClick={duplicate}>Dupliser</button>
            {existing.kind === 'expense' && <button type="button" className="btn btn-ghost" onClick={refund}>Registrer refusjon</button>}
            <span className="flex-1" />
            {confirmDelete ? (
              <button type="button" className="btn btn-ghost btn-danger" onClick={remove} disabled={del.isPending}>Ja, slett</button>
            ) : (
              <button type="button" className="btn btn-ghost btn-danger" onClick={() => setConfirmDelete(true)}>Slett</button>
            )}
          </div>
        )}
      </form>
    </Sheet>
  )
}
