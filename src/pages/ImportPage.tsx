import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { CategorySelect } from '../components/CategorySelect'
import { useToast } from '../components/Toast'
import { fetchExistingForImport, suggestFromRules, useImportTransactions, type ImportRow } from '../lib/api'
import { cleanMerchant, decodeBankFile, importKeys, likelyDuplicates, matchKnownMerchant, parseBankCsv, type BankRow } from '../lib/bankImport'
import { formatDate, monthOf, shiftDay, todayISO } from '../lib/dates'
import { KIND_LABEL, suggestCategory } from '../lib/finance'
import { formatOre } from '../lib/money'
import { errorMessage } from '../lib/supabase'

type Kind = ImportRow['kind']

interface Draft {
  bank: BankRow
  key: string
  merchant: string
  kind: Kind
  categoryId: string | null
  include: boolean
  /** Importert fra før, kan ikke velges igjen */
  imported: boolean
  /** Ser ut som noe du har ført for hånd */
  maybeDuplicate: boolean
}

const KINDS_OUT: Kind[] = ['expense', 'saving']
const KINDS_IN: Kind[] = ['income', 'refund']

export function ImportPage() {
  const app = useApp()
  const navigate = useNavigate()
  const toast = useToast()
  const save = useImportTransactions()
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<Draft[] | null>(null)
  const [skipped, setSkipped] = useState<{ line: number; reason: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [accountId, setAccountId] = useState<string | null>(app.defaultAccountId)
  const [showImported, setShowImported] = useState(false)

  const activeAccounts = app.accounts.filter((a) => !a.is_archived)

  async function readFile(file: File) {
    setError(null)
    setRows(null)
    setReading(true)
    setFileName(file.name)
    try {
      if (/\.xlsx?$/i.test(file.name)) throw new Error('Dette er en Excel-fil. Last ned kontoutskriften som CSV fra nettbanken i stedet.')
      const text = decodeBankFile(await file.arrayBuffer())
      const parsed = parseBankCsv(text)
      if (parsed.rows.length === 0) throw new Error('Fant ingen transaksjoner i filen.')
      const keys = await importKeys(parsed.rows)
      const dates = parsed.rows.map((r) => r.date).sort()
      // Litt slakk i hver ende for å kjenne igjen kjøp du har ført for hånd med en annen dato
      const from = shiftDay(dates[0], -4)
      const to = shiftDay(dates[dates.length - 1], 4)
      const existing = await fetchExistingForImport(app.householdId, from, to)
      const importedKeys = new Set(existing.map((e) => e.import_key).filter(Boolean))
      const fresh = parsed.rows.map((r, i) => ({ r, i })).filter(({ i }) => !importedKeys.has(keys[i]))
      const dupIdx = likelyDuplicates(fresh.map((f) => f.r), existing)
      const dupRows = new Set([...dupIdx].map((j) => fresh[j].i))

      const merchants = parsed.rows.map((r) => matchKnownMerchant(cleanMerchant(r.description), app.merchants))
      // Butikker uten lært kategori slås opp i kjedelista i databasen
      const unknown = [...new Set(parsed.rows.flatMap((r, i) =>
        r.direction === 'out' && merchants[i] && !suggest(merchants[i], 'expense') ? [merchants[i]] : []))]
      const fromRules = await suggestFromRules(app.householdId, unknown).catch(() => new Map<string, string>())

      setRows(parsed.rows.map((r, i) => {
        const merchant = merchants[i]
        const kind: Kind = r.direction === 'out' ? 'expense' : 'income'
        const imported = importedKeys.has(keys[i])
        const maybeDuplicate = dupRows.has(i)
        return {
          bank: r, key: keys[i], merchant, kind,
          categoryId: suggest(merchant, kind) ?? (kind === 'expense' ? fromRules.get(merchant) ?? null : null),
          include: !imported && !maybeDuplicate,
          imported, maybeDuplicate,
        }
      }))
      setSkipped(parsed.skipped)
    } catch (e) {
      setError(e instanceof Error ? e.message : errorMessage(e))
    } finally {
      setReading(false)
    }
  }

  function suggest(merchant: string, kind: Kind): string | null {
    const catKind = kind === 'income' ? 'income' : 'expense'
    const fromMerchant = suggestCategory(merchant, app.merchants)
    if (fromMerchant && app.catById.get(fromMerchant)?.kind === catKind) return fromMerchant
    return null
  }

  const update = (i: number, patch: Partial<Draft>) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const stats = useMemo(() => {
    if (!rows) return null
    const chosen = rows.filter((r) => r.include)
    return {
      chosen: chosen.length,
      out: chosen.filter((r) => r.bank.direction === 'out').reduce((s, r) => s + r.bank.amountOre, 0),
      in: chosen.filter((r) => r.bank.direction === 'in').reduce((s, r) => s + r.bank.amountOre, 0),
      imported: rows.filter((r) => r.imported).length,
      dup: rows.filter((r) => r.maybeDuplicate).length,
      uncategorized: chosen.filter((r) => !r.categoryId && r.kind !== 'income').length,
    }
  }, [rows])

  async function doImport() {
    if (!rows || !stats || stats.chosen === 0) return
    const payload: ImportRow[] = rows.filter((r) => r.include).map((r) => ({
      key: r.key, date: r.bank.date, amount_ore: r.bank.amountOre, kind: r.kind,
      merchant: r.merchant.trim(), category_id: r.categoryId, note: r.bank.description,
    }))
    try {
      const n = await save.mutateAsync({ householdId: app.householdId, accountId, rows: payload })
      toast({ text: n === payload.length ? `${n} transaksjoner er importert` : `${n} importert. ${payload.length - n} fantes fra før.` })
      // Vis måneden med de nyeste radene
      const newest = payload.map((p) => p.date).sort().at(-1)!
      app.setPeriod({ mode: 'month', month: monthOf(newest) })
      navigate('/transaksjoner')
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const visible = rows?.map((r, i) => ({ r, i })).filter(({ r }) => showImported || !r.imported) ?? []

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 pt-4 md:pt-8 pb-52 md:pb-24">
      <Link to="/innstillinger" className="text-sm font-semibold text-accent">Innstillinger</Link>
      <h1 className="text-2xl font-bold tracking-tight mt-1">Importer fra banken</h1>
      <p className="text-sm text-muted mt-1">
        I DNB sin nettbank: velg kontoen, gå til transaksjoner, velg periode og last ned som CSV. Velg filen her.
        Samme fil kan trygt importeres flere ganger, rader som er importert før hoppes over.
      </p>

      <div className="mt-4 rounded-xl bg-surface p-4 space-y-3">
        <input ref={fileInput} type="file" accept=".csv,.txt,text/csv" className="sr-only" id="bankfil"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = '' }} />
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="bankfil" className="btn btn-primary cursor-pointer">{rows ? 'Velg en annen fil' : 'Velg fil'}</label>
          {fileName && <span className="text-sm text-muted truncate">{fileName}</span>}
        </div>
        {activeAccounts.length > 1 && (
          <label className="block">
            <span className="text-sm text-muted">Hvilken konto er dette?</span>
            <select className="field mt-1" value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value || null)}>
              <option value="">Ingen</option>
              {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        {reading && <p className="text-sm text-muted">Leser filen…</p>}
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </div>

      {rows && stats && (
        <>
          <div className="mt-4 text-sm space-y-1">
            <p><strong>{rows.length}</strong> rader i filen. <strong>{stats.chosen}</strong> valgt for import.</p>
            {stats.imported > 0 && (
              <p className="text-muted">
                {stats.imported} er importert før og hoppes over.{' '}
                <button className="font-semibold text-accent underline underline-offset-2" onClick={() => setShowImported(!showImported)}>
                  {showImported ? 'Skjul dem' : 'Vis dem'}
                </button>
              </p>
            )}
            {stats.dup > 0 && <p className="text-warn">{stats.dup} ser ut som kjøp du har ført for hånd, og er ikke valgt. Huk av hvis de likevel skal med.</p>}
            {skipped.length > 0 && <p className="text-muted">{skipped.length} linjer kunne ikke leses (for eksempel saldolinjer) og er hoppet over.</p>}
            {stats.uncategorized > 0 && <p className="text-muted">{stats.uncategorized} valgte rader mangler kategori. Det går fint, du kan sette den senere.</p>}
          </div>

          <ul className="mt-3 space-y-2">
            {visible.map(({ r, i }) => (
              <li key={r.key} className={`rounded-xl bg-surface p-3 ${r.include ? '' : 'opacity-60'}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1.5 size-5 accent-[var(--accent)]" checked={r.include} disabled={r.imported}
                    aria-label={`Ta med ${r.merchant}, ${formatOre(r.bank.amountOre)}`}
                    onChange={(e) => update(i, { include: e.target.checked })} />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <input className="bg-transparent font-medium min-w-0 flex-1 rounded px-1 -mx-1 focus:bg-sunken focus:outline-none" aria-label="Butikk"
                        value={r.merchant} maxLength={80}
                        onChange={(e) => update(i, { merchant: e.target.value })}
                        onBlur={(e) => { if (!r.categoryId) update(i, { categoryId: suggest(e.target.value, r.kind) }) }} />
                      <span className={`num font-semibold whitespace-nowrap ${r.bank.direction === 'in' ? 'text-good' : ''}`}>
                        {r.bank.direction === 'in' ? '+' : '−'}{formatOre(r.bank.amountOre)}
                      </span>
                    </div>
                    <p className="text-xs text-muted truncate" title={r.bank.description}>
                      {formatDate(r.bank.date, todayISO())} · {r.bank.description}
                    </p>
                    {r.imported && <p className="text-xs text-muted">Importert før</p>}
                    {r.maybeDuplicate && !r.imported && <p className="text-xs text-warn">Ligner et kjøp du har ført selv</p>}
                    {!r.imported && (
                      <div className="grid grid-cols-[auto_1fr] gap-2">
                        <select className="field text-sm w-auto" aria-label="Type" value={r.kind}
                          onChange={(e) => {
                            const kind = e.target.value as Kind
                            const c = r.categoryId ? app.catById.get(r.categoryId) : undefined
                            const ok = c && c.kind === (kind === 'income' ? 'income' : 'expense')
                            update(i, { kind, categoryId: ok ? r.categoryId : suggest(r.merchant, kind) })
                          }}>
                          {(r.bank.direction === 'out' ? KINDS_OUT : KINDS_IN).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                        </select>
                        <div className="min-w-0 text-sm">
                          <CategorySelect categories={app.categories} kind={r.kind === 'income' ? 'income' : 'expense'}
                            value={r.categoryId} onChange={(id) => update(i, { categoryId: id })} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Fast knapp nederst, så den alltid er innen rekkevidde i en lang liste */}
          <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] rounded-t-xl md:rounded-none md:bottom-0 md:left-60 z-20 bg-surface/95 backdrop-blur border-t border-line px-4 pt-3 pb-9 md:pb-3">
            <div className="mx-auto max-w-3xl flex items-center gap-3">
              <span className="flex-1 text-sm num">
                <span className="block">Ut {formatOre(stats.out)}</span>
                <span className="block text-good">Inn {formatOre(stats.in)}</span>
              </span>
              <button className="btn btn-primary" disabled={stats.chosen === 0 || save.isPending} onClick={() => void doImport()}>
                {save.isPending ? 'Importerer…' : `Importer ${stats.chosen}`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
