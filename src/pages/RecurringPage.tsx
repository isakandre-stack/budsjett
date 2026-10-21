import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { CategorySelect, categoryColor, categoryPath } from '../components/CategorySelect'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useRecurringMutations, type Recurring, type RecurringInput } from '../lib/api'
import { formatDate, monthOf, shiftMonth, todayISO } from '../lib/dates'
import { KIND_EFFECT, KIND_LABEL, recurringDateIn, type TxKind } from '../lib/finance'
import { formatOre, oreToInput, parseAmountToOre } from '../lib/money'
import { errorMessage } from '../lib/supabase'

const KINDS: TxKind[] = ['expense', 'income', 'saving', 'loan_principal', 'interest_fee']

/** Neste dato posten skal registreres, eller null hvis den er avsluttet eller satt på pause.
 *  En dato før i dag betyr at den registreres med en gang. */
export function nextOccurrence(r: Pick<Recurring, 'day_of_month' | 'start_on' | 'end_on' | 'last_generated_on' | 'is_active'>): string | null {
  if (!r.is_active) return null
  let m = r.last_generated_on ? shiftMonth(monthOf(r.last_generated_on), 1) : monthOf(r.start_on)
  for (let i = 0; i < 400; i++) {
    const d = recurringDateIn(r, m.year, m.month)
    if (r.end_on && d > r.end_on) return null
    if (d >= r.start_on && d > (r.last_generated_on ?? '')) return d
    m = shiftMonth(m, 1)
  }
  return null
}

export function RecurringPage() {
  const app = useApp()
  const today = todayISO()
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null)
  const active = app.recurring.filter((r) => r.is_active)
  const paused = app.recurring.filter((r) => !r.is_active)
  const monthly = (kinds: (r: Recurring) => boolean) => active.filter(kinds).reduce((s, r) => s + r.amount_ore, 0)
  const outMonthly = monthly((r) => KIND_EFFECT[r.kind].cash < 0)
  const inMonthly = monthly((r) => KIND_EFFECT[r.kind].cash > 0)

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 pt-4 md:pt-8">
      <Link to="/innstillinger" className="text-sm font-semibold text-accent">Innstillinger</Link>
      <div className="flex items-center justify-between gap-3 mt-1">
        <h1 className="text-2xl font-bold tracking-tight">Faste poster</h1>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>Ny fast post</button>
      </div>
      <p className="text-sm text-muted mt-1">
        Husleie, strøm, abonnementer, lønn og annet som kommer hver måned. De registreres automatisk på riktig dag,
        og anslaget på oversikten tar dem med fra starten av måneden.
      </p>

      {active.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-surface px-4 py-3"><dt className="text-sm text-muted">Ut hver måned</dt><dd className="num font-semibold">{formatOre(outMonthly)}</dd></div>
          <div className="rounded-xl bg-surface px-4 py-3"><dt className="text-sm text-muted">Inn hver måned</dt><dd className="num font-semibold text-good">{formatOre(inMonthly)}</dd></div>
        </dl>
      )}

      {app.recurring.length === 0 ? (
        <div className="rounded-xl bg-surface p-6 text-center mt-4">
          <p className="text-muted mb-4">Ingen faste poster ennå. Start gjerne med husleie og lønn.</p>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>Legg til den første</button>
        </div>
      ) : (
        <ul className="mt-4 rounded-xl bg-surface divide-y divide-line">
          {[...active, ...paused].map((r) => <Row key={r.id} r={r} today={today} onEdit={() => setEditing(r)} />)}
        </ul>
      )}

      <RecurringEditor target={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function Row({ r, today, onEdit }: { r: Recurring; today: string; onEdit: () => void }) {
  const { catById } = useApp()
  const cat = r.category_id ? catById.get(r.category_id) : undefined
  const next = nextOccurrence(r)
  const positive = KIND_EFFECT[r.kind].cash > 0
  return (
    <li>
      <button className={`w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-sunken rounded-xl ${r.is_active ? '' : 'opacity-60'}`} onClick={onEdit}>
        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: categoryColor(cat, catById) }} />
        <span className="flex-1 min-w-0">
          <span className="block truncate font-medium">{r.merchant}</span>
          <span className="block truncate text-sm text-muted">
            {r.is_active ? (next ? `Neste: ${formatDate(next < today ? today : next, today)}` : 'Avsluttet') : 'På pause'}
            {' · '}{r.day_of_month === 31 ? 'siste dag' : `den ${r.day_of_month}.`}
            {' · '}{cat ? categoryPath(cat, catById) : KIND_LABEL[r.kind]}
          </span>
        </span>
        <span className={`num font-semibold whitespace-nowrap ${positive ? 'text-good' : ''}`}>{positive ? '+' : '−'}{formatOre(r.amount_ore)}</span>
      </button>
    </li>
  )
}

function RecurringEditor({ target, onClose }: { target: Recurring | 'new' | null; onClose: () => void }) {
  const app = useApp()
  const m = useRecurringMutations(app.householdId)
  const toast = useToast()
  const existing = target && target !== 'new' ? target : null

  const [kind, setKind] = useState<TxKind>('expense')
  const [merchant, setMerchant] = useState('')
  const [amount, setAmount] = useState('')
  const [day, setDay] = useState(1)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [startOn, setStartOn] = useState(todayISO())
  const [endOn, setEndOn] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!target) return
    setKind(existing?.kind ?? 'expense')
    setMerchant(existing?.merchant ?? '')
    setAmount(existing ? oreToInput(existing.amount_ore) : '')
    setDay(existing?.day_of_month ?? Number(todayISO().slice(8, 10)))
    setCategoryId(existing?.category_id ?? null)
    setAccountId(existing ? existing.account_id : app.defaultAccountId)
    setStartOn(existing?.start_on ?? todayISO())
    setEndOn(existing?.end_on ?? '')
    setNote(existing?.note ?? '')
    setError(null)
    setConfirmDelete(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const amountOre = parseAmountToOre(amount)
  const today = todayISO()
  const preview = /^\d{4}-\d{2}-\d{2}$/.test(startOn) ? nextOccurrence({
    day_of_month: day, start_on: startOn, end_on: endOn || null, is_active: true,
    last_generated_on: existing?.last_generated_on ?? null,
  }) : null
  // En dato som alt har passert registreres med en gang, sammen med eventuelle senere måneder som også har passert
  const backfill = preview !== null && preview <= today
  const activeAccounts = app.accounts.filter((a) => !a.is_archived || a.id === accountId)
  const catKind = kind === 'income' ? 'income' : 'expense'

  function changeKind(k: TxKind) {
    setKind(k)
    const c = categoryId ? app.catById.get(categoryId) : undefined
    if (c && c.kind !== (k === 'income' ? 'income' : 'expense')) setCategoryId(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!merchant.trim()) return setError('Gi posten et navn, for eksempel Husleie.')
    if (!amountOre) return setError('Skriv inn et gyldig beløp.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startOn)) return setError('Velg en startdato.')
    if (endOn && endOn < startOn) return setError('Sluttdatoen må være etter startdatoen.')
    setError(null)
    const input: RecurringInput = {
      kind, merchant: merchant.trim(), amount_ore: amountOre, day_of_month: day, category_id: categoryId,
      account_id: accountId, start_on: startOn, end_on: endOn || null, note: note.trim() || null,
      is_active: existing?.is_active ?? true,
    }
    try {
      if (existing) await m.update.mutateAsync({ id: existing.id, ...input })
      else await m.create.mutateAsync(input)
      toast({ text: existing ? 'Endringene er lagret' : `${input.merchant} er lagt til` })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function togglePause() {
    if (!existing) return
    try {
      await m.update.mutateAsync({ id: existing.id, is_active: !existing.is_active })
      toast({ text: existing.is_active ? `${existing.merchant} er satt på pause` : `${existing.merchant} er i gang igjen` })
      onClose()
    } catch (err) { setError(errorMessage(err)) }
  }

  async function remove() {
    if (!existing) return
    try {
      await m.remove.mutateAsync(existing.id)
      toast({ text: `${existing.merchant} er slettet. Transaksjoner som alt er registrert, blir liggende.` })
      onClose()
    } catch (err) { setError(errorMessage(err)) }
  }

  const busy = m.create.isPending || m.update.isPending || m.remove.isPending

  return (
    <Sheet open={!!target} onClose={onClose} title={existing ? 'Endre fast post' : 'Ny fast post'}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <label className="block col-span-2 sm:col-span-1">
            <span className="text-sm text-muted">Type</span>
            <select className="field mt-1" value={kind} onChange={(e) => changeKind(e.target.value as TxKind)}>
              {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="block col-span-2 sm:col-span-1">
            <span className="text-sm text-muted">Beløp hver måned</span>
            <input className="field mt-1 num text-lg font-semibold" inputMode="decimal" placeholder="0,00"
              value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!amount && !amountOre} />
          </label>
        </div>
        <label className="block">
          <span className="text-sm text-muted">Navn</span>
          <input className="field mt-1" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder={kind === 'income' ? 'Lønn' : 'Husleie'} maxLength={80} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm text-muted">Dag i måneden</span>
            <select className="field mt-1" value={day} onChange={(e) => setDay(Number(e.target.value))}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d === 31 ? 'Siste dag' : `${d}.`}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm text-muted">Kategori</span>
            <div className="mt-1"><CategorySelect categories={app.categories} kind={catKind} value={categoryId} onChange={setCategoryId} /></div>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm text-muted">Fra og med</span>
            <input type="date" className="field mt-1" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm text-muted">Til og med (valgfritt)</span>
            <input type="date" className="field mt-1" value={endOn} onChange={(e) => setEndOn(e.target.value)} />
          </label>
        </div>
        {activeAccounts.length > 1 && (
          <label className="block">
            <span className="text-sm text-muted">Konto</span>
            <select className="field mt-1" value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value || null)}>
              <option value="">Ingen</option>
              {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-sm text-muted">Notat</span>
          <input className="field mt-1" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </label>

        <p className="text-sm rounded-lg bg-accent-soft px-3 py-2">
          {!preview ? 'Blir ikke registrert flere ganger med denne sluttdatoen.'
            : backfill ? <>Registreres med en gang for <strong>{formatDate(preview, today)}</strong>, og for hver måned etter det som alt har passert.</>
            : <>Registreres neste gang <strong>{formatDate(preview, today)}</strong>.</>}
        </p>

        {error && <p role="alert" className="text-bad text-sm">{error}</p>}
        <button className="btn btn-primary w-full text-base" disabled={busy}>{busy ? 'Lagrer…' : existing ? 'Lagre endringer' : 'Legg til'}</button>

        {existing && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-line">
            <button type="button" className="btn btn-ghost" onClick={togglePause} disabled={busy}>{existing.is_active ? 'Sett på pause' : 'Start igjen'}</button>
            <span className="flex-1" />
            {confirmDelete
              ? <button type="button" className="btn btn-ghost btn-danger" onClick={remove} disabled={busy}>Ja, slett</button>
              : <button type="button" className="btn btn-ghost btn-danger" onClick={() => setConfirmDelete(true)}>Slett</button>}
          </div>
        )}
      </form>
    </Sheet>
  )
}
