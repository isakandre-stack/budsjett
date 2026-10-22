import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { useToast } from '../components/Toast'
import { useIngestTokenMutations, useIngestTokens, type IngestToken } from '../lib/api'
import { errorMessage, publicKey, supabaseUrl } from '../lib/supabase'

const endpoint = () => `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/applepay_ingest`

export function ApplePayPage() {
  const app = useApp()
  const tokens = useIngestTokens(app.userId)
  const m = useIngestTokenMutations()
  const toast = useToast()
  const [fresh, setFresh] = useState<string | null>(null)

  const connect = () => m.create.mutate({ householdId: app.householdId, label: 'iPhone' }, {
    onSuccess: (t) => setFresh(t),
    onError: (e) => toast({ text: errorMessage(e), tone: 'error' }),
  })

  const list = tokens.data ?? []

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 pt-4 md:pt-8 pb-8">
      <Link to="/innstillinger" className="text-sm font-semibold text-accent">Innstillinger</Link>
      <h1 className="text-2xl font-bold tracking-tight mt-1">Apple Pay</h1>
      <p className="text-sm text-muted mt-1">
        Hver gang du betaler med Apple Pay, føres kjøpet automatisk med beløp og butikk. Kategorien hentes fra
        det du har brukt for butikken før. Nye butikker havner uten kategori, så du kan sette den én gang.
      </p>

      {list.length > 0 && (
        <ul className="mt-4 rounded-xl bg-surface divide-y divide-line">
          {list.map((t) => <TokenRow key={t.id} token={t} />)}
        </ul>
      )}

      {fresh ? (
        <Setup token={fresh} onDone={() => setFresh(null)} />
      ) : (
        <button className="btn btn-primary mt-4 w-full sm:w-auto" onClick={connect} disabled={m.create.isPending}>
          {list.length ? 'Koble til en ny iPhone' : 'Koble til iPhone'}
        </button>
      )}

      <p className="text-xs text-muted mt-6">
        Snarveier får bare en egen nøkkel som kan føre kjøp. Den kan ikke lese noe fra budsjettet ditt.
        Mister du telefonen, sletter du tilkoblingen her, så slutter nøkkelen å virke med en gang.
      </p>
    </div>
  )
}

function TokenRow({ token }: { token: IngestToken }) {
  const m = useIngestTokenMutations()
  const toast = useToast()
  const used = token.last_used_at
    ? `Sist kjøp ført ${new Date(token.last_used_at).toLocaleString('nb-NO', { dateStyle: 'medium', timeStyle: 'short' })}`
    : 'Ingen kjøp ført ennå'
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex-1 min-w-0">
        <span className="block font-medium">{token.label}</span>
        <span className="block text-sm text-muted">{used}</span>
      </span>
      <button className="btn btn-ghost btn-danger text-sm" disabled={m.remove.isPending}
        onClick={() => {
          if (!confirm('Slette tilkoblingen? Automasjonen på telefonen slutter å virke.')) return
          m.remove.mutate(token.id, {
            onSuccess: () => toast({ text: 'Tilkoblingen er slettet' }),
            onError: (e) => toast({ text: errorMessage(e), tone: 'error' }),
          })
        }}>
        Slett
      </button>
    </li>
  )
}

function Copy({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const toast = useToast()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      toast({ text: `${label} er kopiert` })
    } catch {
      toast({ text: 'Klarte ikke å kopiere. Merk teksten og kopier den selv.', tone: 'error' })
    }
  }
  return (
    <div className="mt-2">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="flex gap-2 mt-1">
        <code className={`flex-1 min-w-0 rounded-lg bg-sunken px-3 py-2 text-xs break-all select-all ${secret ? 'font-semibold' : ''}`}>{value}</code>
        <button type="button" className="btn btn-ghost bg-sunken text-sm shrink-0" onClick={copy}>Kopier</button>
      </div>
    </div>
  )
}

function Setup({ token, onDone }: { token: string; onDone: () => void }) {
  return (
    <section className="mt-4 rounded-xl bg-surface p-4" aria-labelledby="oppsett">
      <h2 id="oppsett" className="font-bold">Sett opp automasjonen på iPhonen</h2>
      <p className="text-sm text-bad mt-1">Nøkkelen vises bare nå. Fullfør oppsettet før du går fra siden.</p>

      <ol className="mt-4 space-y-5 text-sm">
        <Step n={1} title="Lag automasjonen">
          Åpne <b>Snarveier</b>, gå til <b>Automatisering</b> og trykk <b>+</b>. Velg <b>Transaksjon</b> (under Wallet).
          Velg alle kortene dine, og velg <b>Kjør umiddelbart</b>. Slå av <b>Varsle når kjørt</b> hvis du ikke vil ha varsel hver gang.
        </Step>
        <Step n={2} title="Legg til handlingen">
          Velg <b>Ny tom automatisering</b> og legg til handlingen <b>Hent innholdet i URL</b> (Get Contents of URL). Lim inn adressen:
          <Copy label="URL" value={endpoint()} />
        </Step>
        <Step n={3} title="Metode og overskrift">
          Trykk på pilen for å vise flere valg. Sett <b>Metode</b> til <b>POST</b>. Under <b>Overskrifter</b> legger du til én med
          navnet <code className="bg-sunken px-1 rounded">apikey</code> og denne verdien:
          <Copy label="apikey" value={publicKey} />
        </Step>
        <Step n={4} title="Fire felt i brødteksten">
          Velg <b>JSON</b> som brødtekst og legg til fire felt av typen <b>Tekst</b>:
          <ul className="mt-2 space-y-1.5">
            <li><code className="bg-sunken px-1 rounded">p_token</code>: lim inn nøkkelen under</li>
            <li><code className="bg-sunken px-1 rounded">p_amount</code>: variabelen <b>Transaksjon</b>, og velg <b>Beløp</b></li>
            <li><code className="bg-sunken px-1 rounded">p_merchant</code>: variabelen <b>Transaksjon</b>, og velg <b>Forhandler</b></li>
            <li><code className="bg-sunken px-1 rounded">p_card</code>: variabelen <b>Transaksjon</b>, og velg <b>Kort</b></li>
          </ul>
          <Copy label="Nøkkel (p_token)" value={token} secret />
        </Step>
        <Step n={5} title="Test">
          Lagre automasjonen og betal noe med Apple Pay. Kjøpet dukker opp under Transaksjoner, og her står det når siste kjøp ble ført.
        </Step>
      </ol>

      <button className="btn btn-primary w-full mt-5" onClick={() => { if (confirm('Har du lagt inn nøkkelen? Den vises ikke igjen.')) onDone() }}>
        Ferdig
      </button>
    </section>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="size-7 shrink-0 rounded-full bg-accent text-accent-ink grid place-items-center font-semibold text-sm">{n}</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="text-muted mt-0.5 leading-relaxed">{children}</div>
      </div>
    </li>
  )
}
