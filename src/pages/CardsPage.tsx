import { useState } from 'react'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { PRESETS, appStoreUrl, detectPlatform, loadCustom, normalizeUrl, openUrl, playUrl, saveCustom, type LoyaltyApp } from '../lib/loyalty'

const COLORS = ['#e2001a', '#004b93', '#2c7a55', '#b7741a', '#6b3fa0', '#17211d']

export function CardsPage() {
  const platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints)
  const [custom, setCustom] = useState<LoyaltyApp[]>(loadCustom)
  const [adding, setAdding] = useState(false)
  const toast = useToast()

  const update = (next: LoyaltyApp[]) => {
    setCustom(next)
    if (!saveCustom(next)) toast({ text: 'Klarte ikke å lagre på denne enheten', tone: 'error' })
  }

  const all = [...PRESETS, ...custom]

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 pt-4 md:pt-8">
      <h1 className="text-2xl font-bold tracking-tight">Kort</h1>
      <p className="text-sm text-muted mt-1">
        Trykk for å åpne kundeprogrammet når du står i kassa.
      </p>
      {platform === 'ios' && <ShortcutHelp />}

      <ul className="mt-4 grid grid-cols-2 gap-3">
        {all.map((a) => (
          <li key={a.id} className="relative">
            <AppTile app={a} platform={platform} />
            {a.custom && (
              <button aria-label={`Fjern ${a.name}`}
                className="absolute top-1.5 right-1.5 size-8 grid place-items-center rounded-full text-white/80 hover:bg-black/20"
                onClick={() => { if (confirm(`Fjerne ${a.name}?`)) update(custom.filter((c) => c.id !== a.id)) }}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </button>
            )}
          </li>
        ))}
        <li>
          <button onClick={() => setAdding(true)}
            className="w-full h-28 rounded-2xl border-2 border-dashed border-line text-muted font-medium hover:bg-sunken">
            + Legg til snarvei
          </button>
        </li>
      </ul>

      {platform === 'other' && (
        <p className="text-sm text-muted mt-4">
          Snarveiene er laget for telefonen. Her på PC åpner de appens side i butikken.
        </p>
      )}

      <AddSheet open={adding} onClose={() => setAdding(false)}
        onAdd={(a) => { update([...custom, a]); setAdding(false); toast({ text: `${a.name} er lagt til` }) }} />
    </div>
  )
}

function AppTile({ app, platform }: { app: LoyaltyApp; platform: ReturnType<typeof detectPlatform> }) {
  const href = openUrl(app, platform)
  return (
    <div className="rounded-2xl min-h-28 text-white flex flex-col overflow-hidden shadow-sm" style={{ background: app.color }}>
      <a href={href ?? undefined} target={href?.startsWith('https:') ? '_blank' : undefined} rel="noopener noreferrer"
        className="flex-1 flex flex-col justify-between p-4 active:opacity-80">
        <span className="font-bold text-lg leading-tight pr-6">{app.name}</span>
        <span className="text-sm text-white/85 flex items-center gap-1">
          Åpne
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </a>
      {platform === 'ios' && app.shortcut && app.ios && (
        <a className="text-xs text-center py-1.5 border-t border-white/20 hover:bg-black/15" href={appStoreUrl(app.ios)} target="_blank" rel="noopener noreferrer">
          Virker ikke? Via App Store
        </a>
      )}
      {platform === 'other' && !app.custom && (
        <span className="flex text-xs border-t border-white/20">
          {app.ios && <a className="flex-1 text-center py-1.5 hover:bg-black/15" href={appStoreUrl(app.ios)} target="_blank" rel="noopener noreferrer">App Store</a>}
          {app.android && <a className="flex-1 text-center py-1.5 hover:bg-black/15" href={playUrl(app.android)} target="_blank" rel="noopener noreferrer">Google Play</a>}
        </span>
      )}
    </div>
  )
}

function ShortcutHelp() {
  const names = PRESETS.filter((a) => a.shortcut).map((a) => `«${a.shortcut}»`).join(' og ')
  return (
    <details className="mt-3 rounded-xl bg-surface px-4 py-3 text-sm">
      <summary className="font-medium cursor-pointer">Første gang på iPhone: lag snarveiene</summary>
      <ol className="list-decimal pl-5 mt-2 space-y-1 text-muted">
        <li>Åpne appen Snarveier og trykk +.</li>
        <li>Legg til handlingen Åpne app og velg Trumf.</li>
        <li>Gi snarveien navnet Trumf og lagre.</li>
        <li>Gjør det samme for Coop medlem, med navnet Coop.</li>
      </ol>
      <p className="mt-2 text-muted">Navnene må være nøyaktig {names}. Første gang spør telefonen om lov til å åpne Snarveier.</p>
    </details>
  )
}

function AddSheet({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (a: LoyaltyApp) => void }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [color, setColor] = useState(COLORS[2])
  const [error, setError] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    const u = normalizeUrl(url)
    if (!n) { setError('Gi snarveien et navn'); return }
    if (!u) { setError('Lenken ser ikke riktig ut. Lim inn en adresse som starter med https://'); return }
    onAdd({ id: crypto.randomUUID(), name: n.slice(0, 40), url: u, color, custom: true })
    setName(''); setUrl(''); setError(null)
  }

  return (
    <Sheet open={open} onClose={onClose} title="Ny snarvei">
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Navn</span>
          <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="For eksempel Æ (REMA 1000)" autoFocus />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Lenke</span>
          <input className="field mt-1" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="off" autoCorrect="off"
            placeholder="https://apps.apple.com/..." />
          <span className="block text-xs text-muted mt-1">Lim inn lenken til appen i App Store eller Google Play. Del-knappen i butikken gir deg den.</span>
        </label>
        <fieldset>
          <legend className="text-sm font-medium">Farge</legend>
          <div className="flex gap-2 mt-1">
            {COLORS.map((c) => (
              <button type="button" key={c} aria-label={`Farge ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}
                className={`size-9 rounded-full ${color === c ? 'ring-2 ring-offset-2 ring-accent ring-offset-surface' : ''}`} style={{ background: c }} />
            ))}
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <button className="btn btn-primary w-full">Legg til</button>
      </form>
    </Sheet>
  )
}
