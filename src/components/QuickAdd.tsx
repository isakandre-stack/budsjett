import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../app/AppContext'
import { useDeleteTransaction, useQuickAdd } from '../lib/api'
import { formatDate, shiftDay, todayISO } from '../lib/dates'
import { suggestCategory } from '../lib/finance'
import { formatOre, parseQuickEntry } from '../lib/money'
import { errorMessage } from '../lib/supabase'
import { CategorySelect, categoryColor, categoryPath } from './CategorySelect'
import { Sheet } from './Sheet'
import { useToast } from './Toast'

export function QuickAdd() {
  const app = useApp()
  const { quickOpen, setQuickOpen, merchants, categories, catById } = app
  const [text, setText] = useState('')
  const [chosenCat, setChosenCat] = useState<string | null | undefined>(undefined)
  const [date, setDate] = useState(todayISO())
  const [showDate, setShowDate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const add = useQuickAdd()
  const del = useDeleteTransaction()
  const toast = useToast()

  useEffect(() => {
    if (quickOpen) {
      setText('')
      setChosenCat(undefined)
      setDate(todayISO())
      setShowDate(false)
      setError(null)
      setTimeout(() => input.current?.focus(), 30)
    }
  }, [quickOpen])

  const parsed = parseQuickEntry(text)
  const kind = parsed?.income ? 'income' : 'expense'
  // Først hva du har brukt hos samme butikk før, ellers en kategori med samme navn (for eksempel "Lønn")
  const byName = parsed?.merchant
    ? categories.find((c) => !c.is_archived && c.kind === kind && c.name.toLowerCase() === parsed.merchant.trim().toLowerCase())?.id ?? null
    : null
  const fromMerchant = parsed ? suggestCategory(parsed.merchant, merchants) : null
  const suggestedOk = [fromMerchant, byName].find((id) => id && catById.get(id)?.kind === kind) ?? null
  const categoryId = chosenCat !== undefined ? chosenCat : suggestedOk

  // Mest brukte butikker og kategorier, for raske valg
  const recentMerchants = merchants.filter((m) => m.use_count > 0).slice(0, 6)
  const topCats = useMemo(() => {
    const score = new Map<string, number>()
    for (const m of merchants) if (m.default_category_id) score.set(m.default_category_id, (score.get(m.default_category_id) ?? 0) + m.use_count)
    return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => catById.get(id)).filter((c) => c && !c.is_archived && c.kind === kind).slice(0, 5)
  }, [merchants, catById, kind])

  async function save() {
    if (!parsed || add.isPending) return
    setError(null)
    try {
      const tx = await add.mutateAsync({
        householdId: app.householdId, kind, amountOre: parsed.amountOre, merchant: parsed.merchant,
        categoryId: categoryId ?? null, occurredOn: date, accountId: app.defaultAccountId,
      }) as { id: string }
      setQuickOpen(false)
      toast({
        text: `Lagret ${formatOre(parsed.amountOre)}${parsed.merchant ? ` hos ${parsed.merchant}` : ''}`,
        action: { label: 'Angre', run: () => del.mutate(tx.id) },
      })
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  function moreDetails() {
    setQuickOpen(false)
    app.setEditor({
      type: 'new',
      draft: {
        kind, amount_ore: parsed?.amountOre, occurred_on: date,
        category_id: categoryId ?? null, merchantName: parsed?.merchant ?? text,
      },
    })
  }

  const close = () => setQuickOpen(false)

  return (
    <Sheet open={quickOpen} onClose={close} title="Registrer kjøp">
      <form onSubmit={(e) => { e.preventDefault(); void save() }}>
        <label htmlFor="quick" className="sr-only">Beløp og butikk</label>
        <input
          id="quick"
          ref={input}
          className="field text-xl font-semibold"
          placeholder="249 REMA"
          autoComplete="off"
          autoCapitalize="characters"
          enterKeyHint="done"
          value={text}
          onChange={(e) => { setText(e.target.value); setChosenCat(undefined) }}
        />
        <p className="text-xs text-muted mt-1.5">Beløp og butikk. Sett + foran for inntekt, for eksempel +32000 Lønn.</p>

        {!text && recentMerchants.length > 0 && (
          <div className="mt-4">
            <p className="text-sm text-muted mb-2">Nylig brukt</p>
            <div className="flex flex-wrap gap-2">
              {recentMerchants.map((m) => (
                <button type="button" key={m.id} className="rounded-full bg-sunken px-3 py-1.5 text-sm"
                  onClick={() => { setText(`${m.name} `); input.current?.focus() }}>
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {parsed && (
          <div className="mt-5 rounded-xl bg-sunken p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate font-medium">{parsed.merchant || 'Uten butikk'}</span>
              <span className={`num text-2xl font-bold ${kind === 'income' ? 'text-good' : ''}`}>
                {kind === 'income' ? '+' : ''}{formatOre(parsed.amountOre)}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1">
                <span className="size-2 rounded-full" style={{ background: categoryColor(categoryId ? catById.get(categoryId) : undefined, catById) }} />
                {categoryId ? categoryPath(catById.get(categoryId), catById) : 'Ingen kategori'}
                {chosenCat === undefined && suggestedOk && <span className="text-muted">(forslag)</span>}
              </span>
              <button type="button" className="rounded-full bg-surface px-3 py-1" onClick={() => setShowDate((v) => !v)}>
                {formatDate(date)}
              </button>
              <span className="text-muted">{kind === 'income' ? 'Inntekt' : 'Utgift'}</span>
            </div>
            {showDate && (
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn btn-ghost bg-surface flex-1" onClick={() => { setDate(shiftDay(todayISO(), -1)); setShowDate(false) }}>I går</button>
                <input type="date" className="field flex-1" value={date} max="2100-12-31" aria-label="Dato"
                  onChange={(e) => e.target.value && setDate(e.target.value)} />
              </div>
            )}
          </div>
        )}

        {parsed && (
          <div className="mt-4">
            {topCats.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {topCats.map((c) => (
                  <button type="button" key={c!.id} aria-pressed={categoryId === c!.id}
                    className={`rounded-full px-3 py-1.5 text-sm border ${categoryId === c!.id ? 'bg-accent text-accent-ink border-accent' : 'border-line'}`}
                    onClick={() => setChosenCat(c!.id)}>
                    {c!.name}
                  </button>
                ))}
              </div>
            )}
            <label htmlFor="quick-cat" className="sr-only">Kategori</label>
            <CategorySelect id="quick-cat" categories={categories} kind={kind} value={categoryId ?? null} onChange={setChosenCat} />
          </div>
        )}

        {error && <p role="alert" className="text-bad text-sm mt-3">{error}</p>}
        {text && !parsed && <p className="text-sm text-muted mt-3">Skriv et beløp, for eksempel 249 eller 89,90.</p>}

        <div className="mt-5 flex gap-2">
          <button type="button" className="btn btn-ghost" onClick={moreDetails}>Flere detaljer</button>
          <button className="btn btn-primary flex-1 text-base" disabled={!parsed || add.isPending}>
            {add.isPending ? 'Lagrer…' : 'Lagre'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
