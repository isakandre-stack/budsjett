import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { periodOf, useApp } from '../app/AppContext'
import { CategorySelect } from '../components/CategorySelect'
import { PeriodPicker } from '../components/PeriodPicker'
import { TxRow } from '../components/TxRow'
import { useTransactions, type Transaction } from '../lib/api'
import { formatDate } from '../lib/dates'
import { categoryLines, KIND_EFFECT, KIND_LABEL, type TxKind } from '../lib/finance'
import { formatOre } from '../lib/money'

type Sort = 'date' | 'amount_desc' | 'amount_asc'

export function Transactions() {
  const app = useApp()
  const period = periodOf(app.period)
  const q = useTransactions(app.householdId, period)
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<TxKind | ''>('')
  const [sort, setSort] = useState<Sort>('date')
  const catFilter = params.get('kategori')

  const setCatFilter = (id: string | null) => {
    const p = new URLSearchParams(params)
    if (id) p.set('kategori', id)
    else p.delete('kategori')
    setParams(p, { replace: true })
  }

  const filtered = useMemo(() => {
    if (!q.data) return []
    const needle = search.trim().toLowerCase()
    const matchesCat = (t: Transaction) => {
      if (!catFilter) return true
      return categoryLines(t).some((l) => {
        if (catFilter === 'ingen') return l.category_id === null && KIND_EFFECT[t.kind].spending !== 0
        if (!l.category_id) return false
        const c = app.catById.get(l.category_id)
        return l.category_id === catFilter || c?.parent_id === catFilter
      })
    }
    const list = q.data.filter((t) => {
      if (kind && t.kind !== kind) return false
      if (!matchesCat(t)) return false
      if (!needle) return true
      const merchant = t.merchant_id ? app.merchantById.get(t.merchant_id)?.name ?? '' : ''
      const cats = categoryLines(t).map((l) => (l.category_id ? app.catById.get(l.category_id)?.name ?? '' : '')).join(' ')
      const hay = [merchant, t.description, t.note, t.tags.join(' '), cats, KIND_LABEL[t.kind]].join(' ').toLowerCase()
      return hay.includes(needle) || String(t.amount_ore / 100).includes(needle.replace(',', '.'))
    })
    if (sort === 'amount_desc') list.sort((a, b) => b.amount_ore - a.amount_ore)
    if (sort === 'amount_asc') list.sort((a, b) => a.amount_ore - b.amount_ore)
    return list
  }, [q.data, search, kind, sort, catFilter, app.catById, app.merchantById])

  const spending = filtered.reduce((sum, t) => sum + KIND_EFFECT[t.kind].spending * t.amount_ore, 0)
  const groups = useMemo(() => {
    if (sort !== 'date') return [{ date: null as string | null, items: filtered }]
    const map = new Map<string, Transaction[]>()
    for (const t of filtered) map.set(t.occurred_on, [...(map.get(t.occurred_on) ?? []), t])
    return [...map.entries()].map(([date, items]) => ({ date: date as string | null, items }))
  }, [filtered, sort])

  const catName = catFilter === 'ingen' ? 'Ukategorisert' : catFilter ? app.catById.get(catFilter)?.name : null

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 pt-4 md:pt-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Transaksjoner</h1>
        <PeriodPicker />
      </header>

      <div className="mt-4 space-y-2">
        <input type="search" className="field" placeholder="Søk på butikk, notat, kategori eller beløp" aria-label="Søk"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <select className="field text-sm" aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as TxKind | '')}>
            <option value="">Alle typer</option>
            {(Object.keys(KIND_LABEL) as TxKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <select className="field text-sm" aria-label="Sortering" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="date">Nyeste først</option>
            <option value="amount_desc">Største beløp først</option>
            <option value="amount_asc">Minste beløp først</option>
          </select>
          <div className="col-span-2 sm:col-span-1 text-sm">
            <CategorySelect categories={app.categories} value={catFilter === 'ingen' ? null : catFilter} onChange={setCatFilter} emptyLabel="Alle kategorier" />
          </div>
        </div>
        {catName && (
          <p className="text-sm">
            Viser {catName}.{' '}
            <button className="font-semibold text-accent underline underline-offset-2" onClick={() => setCatFilter(null)}>Vis alle</button>
          </p>
        )}
      </div>

      {q.error && <p className="text-bad mt-6">Klarte ikke å hente transaksjoner. {(q.error as Error).message}</p>}
      {q.isLoading && <p className="text-muted mt-8">Henter transaksjoner…</p>}

      {q.data && (
        <>
          <p className="text-sm text-muted mt-5 num">
            {filtered.length} {filtered.length === 1 ? 'transaksjon' : 'transaksjoner'}, forbruk {formatOre(spending)}
          </p>
          {filtered.length === 0 ? (
            <div className="rounded-xl bg-surface p-6 text-center mt-3">
              <p className="text-muted mb-4">{q.data.length === 0 ? 'Ingenting registrert i perioden.' : 'Ingen transaksjoner passer søket.'}</p>
              {q.data.length === 0 && <button className="btn btn-primary" onClick={() => app.setQuickOpen(true)}>Registrer kjøp</button>}
            </div>
          ) : (
            <div className="mt-3 space-y-5">
              {groups.map((g) => (
                <section key={g.date ?? 'all'} aria-label={g.date ? formatDate(g.date) : 'Transaksjoner'}>
                  {g.date && (
                    <h2 className="flex justify-between text-sm text-muted px-1 mb-1">
                      <span className="first-letter:uppercase">{formatDate(g.date)}</span>
                      <span className="num">{formatOre(g.items.reduce((a, t) => a + KIND_EFFECT[t.kind].spending * t.amount_ore, 0))}</span>
                    </h2>
                  )}
                  <div className="rounded-xl bg-surface px-3 py-1">
                    {g.items.map((t) => <TxRow key={t.id} tx={t} />)}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
