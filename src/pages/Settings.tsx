import { useState } from 'react'
import { useApp } from '../app/AppContext'
import { useToast } from '../components/Toast'
import { useAccountMutations, useCategoryMutations, useSetTheme, type Category } from '../lib/api'
import { errorMessage, supabase } from '../lib/supabase'
import { applyTheme, storedTheme, type Theme } from '../lib/theme'

export function Settings() {
  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 pt-4 md:pt-8 space-y-10">
      <h1 className="text-2xl font-bold tracking-tight">Innstillinger</h1>
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
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast({ text: ok }) } catch (e) { toast({ text: errorMessage(e), tone: 'error' }) }
  }
  return { m, run }
}

function NameField({ cat }: { cat: Category }) {
  const { m, run } = useCatMut()
  const [name, setName] = useState(cat.name)
  const commit = () => {
    const n = name.trim()
    if (!n) { setName(cat.name); return }
    if (n !== cat.name) void run(() => m.update.mutateAsync({ id: cat.id, name: n }))
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
        .then(() => setName(''))
    }}>
      <input className="field text-sm" placeholder={label} aria-label={label} value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn btn-ghost bg-sunken text-sm" disabled={!name.trim()}>Legg til</button>
    </form>
  )
}

const ACCOUNT_TYPES: [string, string][] = [
  ['checking', 'Brukskonto'], ['savings', 'Sparekonto'], ['credit_card', 'Kredittkort'],
  ['cash', 'Kontanter'], ['investment', 'Investering'], ['loan', 'Lån'], ['other', 'Annet'],
]

function Accounts() {
  const { accounts, householdId } = useApp()
  const m = useAccountMutations(householdId)
  const toast = useToast()
  const [name, setName] = useState('')
  const [type, setType] = useState('savings')
  const typeLabel = (t: string) => ACCOUNT_TYPES.find(([v]) => v === t)?.[1] ?? t

  return (
    <Section id="kontoer" title="Kontoer" intro="Med to eller flere kontoer kan du registrere overføringer, som aldri teller som inntekt eller forbruk.">
      <ul className="rounded-xl bg-surface divide-y divide-line">
        {accounts.filter((a) => !a.is_archived).map((a) => (
          <li key={a.id} className="flex items-center gap-2 px-3 py-2.5">
            <span className="flex-1">{a.name}</span>
            <span className="text-sm text-muted">{typeLabel(a.type)}</span>
            {accounts.filter((x) => !x.is_archived).length > 1 && (
              <button className="text-sm text-muted px-2 py-1 rounded hover:bg-sunken"
                onClick={() => m.update.mutate({ id: a.id, is_archived: true }, { onSuccess: () => toast({ text: `${a.name} er arkivert` }) })}>Arkiver</button>
            )}
          </li>
        ))}
      </ul>
      <form className="flex flex-wrap gap-2 mt-2" onSubmit={(e) => {
        e.preventDefault()
        const n = name.trim()
        if (!n) return
        m.create.mutate({ name: n, type }, {
          onSuccess: () => { setName(''); toast({ text: `${n} er lagt til` }) },
          onError: (err) => toast({ text: errorMessage(err), tone: 'error' }),
        })
      }}>
        <input className="field text-sm flex-1 min-w-40" placeholder="Navn på ny konto" aria-label="Navn på ny konto" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="field text-sm w-auto" aria-label="Kontotype" value={type} onChange={(e) => setType(e.target.value)}>
          {ACCOUNT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="btn btn-ghost bg-sunken text-sm" disabled={!name.trim()}>Legg til</button>
      </form>
    </Section>
  )
}

function Security() {
  const { email } = useApp()
  return (
    <Section id="sikkerhet" title="Innlogging og sikkerhet">
      <div className="rounded-xl bg-surface p-4 space-y-3">
        <p>Logget inn som <span className="font-medium">{email}</span></p>
        <p className="text-sm text-muted">Bare du har bruker. Ingen kan registrere seg selv, og databasen viser bare dine egne data.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost bg-sunken" onClick={() => supabase.auth.signOut({ scope: 'local' })}>Logg ut</button>
          <button className="btn btn-ghost bg-sunken" onClick={() => supabase.auth.signOut({ scope: 'global' })}>Logg ut på alle enheter</button>
        </div>
      </div>
    </Section>
  )
}
