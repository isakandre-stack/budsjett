import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { useToast } from '../components/Toast'
import { useAccountMutations, useCategoryMutations, useSetDefaultAccount, useSetTheme, type Account, type Category } from '../lib/api'
import { errorMessage, supabase } from '../lib/supabase'
import { applyTheme, storedTheme, type Theme } from '../lib/theme'
import { appVersion } from '../lib/update'
import { formatOre, oreToInput, parseAmountToOre } from '../lib/money'
import { useBalances } from '../lib/useBalances'

export function Settings() {
  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 pt-4 md:pt-8 space-y-10">
      <h1 className="text-2xl font-bold tracking-tight">Innstillinger</h1>
      <Planning />
      <Appearance />
      <Categories />
      <Accounts />
      <Security />
    </div>
  )
}

function Section({ id, title, children, intro }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="font-bold text-lg">{title}</h2>
      {intro && <p className="text-sm text-muted mt-1">{intro}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Planning() {
  const { budgets, recurring } = useApp()
  const items = [
    { to: '/budsjett', title: 'Budsjett', text: budgets.length ? `${budgets.length} kategorier har budsjett` : 'Sett et beløp per kategori i måneden' },
    { to: '/faste', title: 'Faste poster', text: recurring.length ? `${recurring.filter((r) => r.is_active).length} aktive, registreres automatisk` : 'Husleie, abonnementer og lønn, registrert automatisk' },
    { to: '/abonnementer', title: 'Abonnementer', text: 'Finner det som trekkes jevnlig, og hva det koster i året' },
    { to: '/apple-pay', title: 'Automatisk fra Apple Pay', text: 'Kjøp føres av seg selv når du betaler med telefonen' },
    { to: '/import', title: 'Importer fra banken', text: 'Last inn kontoutskrift fra DNB som CSV' },
  ]
  return (
    <ul className="rounded-xl bg-surface divide-y divide-line">
      {items.map((it) => (
        <li key={it.to}>
          <Link to={it.to} className="flex items-center gap-3 px-4 py-3 hover:bg-sunken rounded-xl">
            <span className="flex-1 min-w-0">
              <span className="block font-medium">{it.title}</span>
              <span className="block text-sm text-muted truncate">{it.text}</span>
            </span>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="text-muted"><path d="M7 4l5 5-5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Appearance() {
  const { userId } = useApp()
  const [theme, setTheme] = useState<Theme>(storedTheme())
  const save = useSetTheme()
  const opts: [Theme, string][] = [['system', 'Følg telefonen'], ['light', 'Lys'], ['dark', 'Mørk']]
  return (
    <Section id="utseende" title="Utseende">
      <div role="radiogroup" aria-label="Tema" className="inline-flex rounded-xl bg-sunken p-1">
        {opts.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={theme === v}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${theme === v ? 'bg-surface shadow-sm' : 'text-muted'}`}
            onClick={() => { setTheme(v); applyTheme(v); save.mutate({ userId, theme: v }) }}>
            {l}
          </button>
        ))}
      </div>
    </Section>
  )
}

function Categories() {
  const { categories } = useApp()
  const [showArchived, setShowArchived] = useState(false)
  const parents = categories.filter((c) => !c.parent_id)
  const active = parents.filter((c) => !c.is_archived)
  const archived = categories.filter((c) => c.is_archived)

  return (
    <Section id="kategorier" title="Kategorier"
      intro="Gi nytt navn ved å trykke på navnet. Arkiverte kategorier skjules i valglister, men gamle transaksjoner beholder dem.">
      <div className="space-y-4">
        {(['expense', 'income'] as const).map((kind) => (
          <div key={kind}>
            <h3 className="text-sm text-muted mb-1">{kind === 'expense' ? 'Utgifter' : 'Inntekter'}</h3>
            <ul className="rounded-xl bg-surface divide-y divide-line">
              {active.filter((p) => p.kind === kind).map((p) => (
                <ParentRow key={p.id} parent={p} subs={categories.filter((c) => c.parent_id === p.id && !c.is_archived)} />
              ))}
            </ul>
            <NewCategory kind={kind} parentId={null} label={kind === 'expense' ? 'Ny utgiftskategori' : 'Ny inntektskategori'} />
          </div>
        ))}
        {archived.length > 0 && (
          <div>
            <button className="text-sm font-semibold text-accent" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
              {showArchived ? 'Skjul arkiverte' : `Vis arkiverte (${archived.length})`}
            </button>
            {showArchived && (
              <ul className="mt-2 rounded-xl bg-surface divide-y divide-line">
                {archived.map((c) => <ArchivedRow key={c.id} cat={c} />)}
              </ul>
            )}
          </div>
        )}
      </div>
    </Section>
  )
}

function useCatMut() {
  const { householdId } = useApp()
  const toast = useToast()
  const m = useCategoryMutations(householdId)
  /** Returnerer true hvis det gikk bra, så feltet bare tømmes eller beholdes når lagringen faktisk lyktes. */
  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    try { await fn(); if (ok) toast({ text: ok }); return true } catch (e) { toast({ text: errorMessage(e), tone: 'error' }); return false }
  }
  return { m, run }
}

function NameField({ cat }: { cat: Category }) {
  const { m, run } = useCatMut()
  const [name, setName] = useState(cat.name)
  const commit = () => {
    const n = name.trim()
    if (!n) { setName(cat.name); return }
    if (n === cat.name) { setName(n); return }
    // Hvis navnet ble avvist (for eksempel fordi det finnes fra før), vises det gamle navnet igjen
    void run(() => m.update.mutateAsync({ id: cat.id, name: n })).then((ok) => setName(ok ? n : cat.name))
  }
  return (
    <input className="bg-transparent rounded px-1 -mx-1 py-1 min-w-0 flex-1 focus:bg-sunken focus:outline-none" aria-label={`Navn på ${cat.name}`}
      value={name} onChange={(e) => setName(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setName(cat.name) }} />
  )
}

function ParentRow({ parent, subs }: { parent: Category; subs: Category[] }) {
  const { m, run } = useCatMut()
  const [open, setOpen] = useState(false)
  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2">
        <label className="relative size-6 shrink-0 rounded-full overflow-hidden cursor-pointer" style={{ background: parent.color ?? 'var(--muted)' }}>
          <span className="sr-only">Farge for {parent.name}</span>
          <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" value={parent.color ?? '#94a3b8'}
            onChange={(e) => void run(() => m.update.mutateAsync({ id: parent.id, color: e.target.value }))} />
        </label>
        <NameField cat={parent} />
        <button className="text-sm text-muted px-2 py-1 rounded hover:bg-sunken" aria-expanded={open} onClick={() => setOpen(!open)}>
          {subs.length > 0 ? `${subs.length} under` : 'Under'}
        </button>
        <button className="text-sm text-muted px-2 py-1 rounded hover:bg-sunken"
          onClick={() => void run(() => m.update.mutateAsync({ id: parent.id, is_archived: true }), `${parent.name} er arkivert`)}>
          Arkiver
        </button>
      </div>
      {open && (
        <div className="ml-8 mt-1">
          <ul>
            {subs.map((s) => (
              <li key={s.id} className="flex items-center gap-2 py-1">
                <NameField cat={s} />
                <button className="text-sm text-muted px-2 py-1 rounded hover:bg-sunken"
                  onClick={() => void run(() => m.update.mutateAsync({ id: s.id, is_archived: true }), `${s.name} er arkivert`)}>Arkiver</button>
              </li>
            ))}
          </ul>
          <NewCategory kind={parent.kind} parentId={parent.id} label="Ny underkategori" color={parent.color} />
        </div>
      )}
    </li>
  )
}

function ArchivedRow({ cat }: { cat: Category }) {
  const { m, run } = useCatMut()
  const { catById } = useApp()
  const parent = cat.parent_id ? catById.get(cat.parent_id) : undefined
  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <span className="flex-1 text-muted">{parent ? `${parent.name} / ` : ''}{cat.name}</span>
      <button className="text-sm font-semibold text-accent px-2 py-1"
        onClick={() => void run(() => m.update.mutateAsync({ id: cat.id, is_archived: false }), `${cat.name} er tilbake`)}>Gjenopprett</button>
    </li>
  )
}

function NewCategory({ kind, parentId, label, color }: { kind: 'expense' | 'income'; parentId: string | null; label: string; color?: string | null }) {
  const { m, run } = useCatMut()
  const { categories } = useApp()
  const [name, setName] = useState('')
  return (
    <form className="flex gap-2 mt-2" onSubmit={(e) => {
      e.preventDefault()
      const n = name.trim()
      if (!n) return
      const max = Math.max(0, ...categories.filter((c) => c.parent_id === parentId).map((c) => c.sort_order))
      void run(() => m.create.mutateAsync({ name: n, parent_id: parentId, kind, color: color ?? (parentId ? null : '#64748b'), sort_order: max + 10 }), `${n} er lagt til`)
        .then((ok) => { if (ok) setName('') })
    }}>
      <input className="field text-sm" placeholder={label} aria-label={label} value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn btn-ghost bg-sunken text-sm whitespace-nowrap" disabled={!name.trim()}>Legg til</button>
    </form>
  )
}

const ACCOUNT_TYPES: [string, string][] = [
  ['checking', 'Brukskonto'], ['savings', 'Sparekonto'], ['credit_card', 'Kredittkort'],
  ['cash', 'Kontanter'], ['investment', 'Investering'], ['loan', 'Lån'], ['other', 'Annet'],
]

function Accounts() {
  const { accounts, householdId, defaultAccountId, userId } = useApp()
  const m = useAccountMutations(householdId)
  const setDefault = useSetDefaultAccount()
  const toast = useToast()
  const [name, setName] = useState('')
  const [type, setType] = useState('savings')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const { balances } = useBalances()
  const typeLabel = (t: string) => ACCOUNT_TYPES.find(([v]) => v === t)?.[1] ?? t
  const active = accounts.filter((a) => !a.is_archived)
  const archived = accounts.filter((a) => a.is_archived)
  const fail = (err: unknown) => toast({ text: errorMessage(err), tone: 'error' })

  const archive = (a: Account) => m.update.mutate({ id: a.id, is_archived: true }, {
    onSuccess: () => toast({ text: `${a.name} er arkivert` }),
    onError: fail,
  })
  const restore = (a: Account) => m.update.mutate({ id: a.id, is_archived: false }, {
    onSuccess: () => toast({ text: `${a.name} er tilbake` }),
    onError: fail,
  })
  const makeDefault = (a: Account) => setDefault.mutate({ userId, accountId: a.id }, {
    onSuccess: () => toast({ text: `${a.name} brukes nå for nye kjøp` }),
    onError: fail,
  })

  return (
    <Section id="kontoer" title="Kontoer" intro="Med to eller flere kontoer kan du registrere overføringer, som aldri teller som inntekt eller forbruk. Standardkontoen brukes for nye kjøp.">
      <ul className="rounded-xl bg-surface divide-y divide-line">
        {active.map((a) => {
          const isDefault = a.id === defaultAccountId
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <span className="flex-1 min-w-0">
                <span className="block truncate">{a.name}</span>
                <span className="block text-xs text-muted">
                  {typeLabel(a.type)}
                  {balances?.has(a.id) && <> · saldo <span className="num text-ink font-medium">{formatOre(balances.get(a.id)!)}</span></>}
                </span>
              </span>
              {isDefault ? (
                <span className="text-xs font-semibold rounded-full bg-accent-soft px-2 py-1">Standard</span>
              ) : (
                <button className="text-sm text-muted px-2 py-1 rounded hover:bg-sunken" disabled={setDefault.isPending} onClick={() => makeDefault(a)}>
                  Gjør til standard
                </button>
              )}
              <button className="text-sm text-muted px-2 py-1 rounded hover:bg-sunken" aria-expanded={editing === a.id}
                onClick={() => setEditing(editing === a.id ? null : a.id)}>
                Endre
              </button>
              {editing === a.id && <OpeningBalance a={a} onDone={() => setEditing(null)} />}
              {/* Standardkontoen kan ikke arkiveres, ellers ville nye kjøp havnet på en skjult konto */}
              {!isDefault && active.length > 1 && (
                <button className="text-sm text-muted px-2 py-1 rounded hover:bg-sunken" disabled={m.update.isPending} onClick={() => archive(a)}>Arkiver</button>
              )}
            </li>
          )
        })}
      </ul>
      {!defaultAccountId && active.length > 0 && (
        <p className="text-sm text-warn mt-2">Ingen standardkonto er valgt. Nye kjøp lagres uten konto til du velger en.</p>
      )}
      <form className="flex flex-wrap gap-2 mt-2" onSubmit={(e) => {
        e.preventDefault()
        const n = name.trim()
        if (!n) return
        m.create.mutate({ name: n, type }, {
          onSuccess: () => { setName(''); toast({ text: `${n} er lagt til` }) },
          onError: fail,
        })
      }}>
        <input className="field text-sm flex-1 min-w-40" placeholder="Navn på ny konto" aria-label="Navn på ny konto" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="field text-sm w-auto" aria-label="Kontotype" value={type} onChange={(e) => setType(e.target.value)}>
          {ACCOUNT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="btn btn-ghost bg-sunken text-sm whitespace-nowrap" disabled={!name.trim() || m.create.isPending}>Legg til</button>
      </form>
      {archived.length > 0 && (
        <div className="mt-3">
          <button className="text-sm font-semibold text-accent" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? 'Skjul arkiverte kontoer' : `Vis arkiverte kontoer (${archived.length})`}
          </button>
          {showArchived && (
            <ul className="mt-2 rounded-xl bg-surface divide-y divide-line">
              {archived.map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="flex-1 text-muted">{a.name}</span>
                  <button className="text-sm font-semibold text-accent px-2 py-1" onClick={() => restore(a)}>Gjenopprett</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  )
}

function Security() {
  const { email } = useApp()
  return (
    <Section id="sikkerhet" title="Innlogging og sikkerhet">
      <div className="rounded-xl bg-surface p-4 space-y-3">
        <p>Logget inn som <span className="font-medium">{email}</span></p>
        <p className="text-sm text-muted">Versjon {appVersion}</p>
        <p className="text-sm text-muted">Bare du har bruker. Ingen kan registrere seg selv, og databasen viser bare dine egne data.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost bg-sunken" onClick={() => supabase.auth.signOut({ scope: 'local' })}>Logg ut</button>
          <button className="btn btn-ghost bg-sunken" onClick={() => supabase.auth.signOut({ scope: 'global' })}>Logg ut på alle enheter</button>
        </div>
      </div>
    </Section>
  )
}

/** Saldoen på kontoen en gitt dag. Alt som føres fra og med den dagen, regnes inn i saldoen. */
function OpeningBalance({ a, onDone }: { a: Account; onDone: () => void }) {
  const [name, setName] = useState(a.name)
  const [type, setType] = useState(a.type)
  const { householdId } = useApp()
  const m = useAccountMutations(householdId)
  const toast = useToast()
  const debt = a.type === 'credit_card' || a.type === 'loan'
  const start = a.opening_balance_ore
  const [amount, setAmount] = useState(start === null ? '' : oreToInput(Math.abs(start)))
  const [owe, setOwe] = useState(start === null ? debt : start < 0)
  const [date, setDate] = useState(a.opening_balance_on ?? '2026-11-01')
  const [error, setError] = useState<string | null>(null)
  const ore = amount.trim() === '0' ? 0 : parseAmountToOre(amount)
  const hasBalance = amount.trim() !== ''

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Kontoen må ha et navn.')
    if (hasBalance && ore === null) return setError('Skriv inn et gyldig beløp.')
    if (hasBalance && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Velg en dato.')
    const balance = hasBalance && ore !== null
      ? { opening_balance_ore: owe ? -ore : ore, opening_balance_on: date }
      : { opening_balance_ore: null, opening_balance_on: null }
    m.update.mutate({ id: a.id, name: name.trim(), type, ...balance }, {
      onSuccess: () => { toast({ text: `${name.trim()} er lagret` }); onDone() },
      onError: (err) => setError(errorMessage(err)),
    })
  }
  function clear() {
    m.update.mutate({ id: a.id, opening_balance_ore: null, opening_balance_on: null }, {
      onSuccess: () => { toast({ text: `Startsaldo for ${a.name} er fjernet` }); onDone() },
      onError: (err) => setError(errorMessage(err)),
    })
  }

  return (
    <form onSubmit={save} className="basis-full mt-1 rounded-lg bg-sunken p-3 space-y-3" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm text-muted">Navn</span>
          <input className="field mt-1" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm text-muted">Type</span>
          <select className="field mt-1" value={type} onChange={(e) => setType(e.target.value)}>
            {ACCOUNT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <p className="text-sm text-muted">Startsaldo: hva sto på kontoen ved starten av dagen? Alt du fører fra og med denne datoen, regnes inn i saldoen. La beløpet stå tomt hvis du ikke vil følge saldoen.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm text-muted">Beløp</span>
          <input className="field mt-1 num" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!amount && ore === null} />
        </label>
        <label className="block">
          <span className="text-sm text-muted">Per dato</span>
          <input type="date" className="field mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={owe} onChange={(e) => setOwe(e.target.checked)} />
        Dette er gjeld (for eksempel ubetalt på kredittkortet)
      </label>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={m.update.isPending}>Lagre</button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>Avbryt</button>
        <span className="flex-1" />
        {start !== null && <button type="button" className="btn btn-ghost btn-danger" onClick={clear} disabled={m.update.isPending}>Fjern startsaldo</button>}
      </div>
    </form>
  )
}
