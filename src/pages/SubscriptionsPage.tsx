import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useSetIgnoredSubscriptions, type Recurring, type Transaction } from '../lib/api'
import { formatDate, todayISO } from '../lib/dates'
import { formatOre } from '../lib/money'
import { errorMessage } from '../lib/supabase'
import { FREQ_LABEL, ignoreKeyOf, type Subscription } from '../lib/subscriptions'
import { useSubscriptions } from '../lib/useSubscriptions'
import { RecurringEditor, type RecurringDraft } from './RecurringPage'

const kr = (ore: number) => formatOre(ore, { decimals: 'auto' })

export function SubscriptionsPage() {
  const app = useApp()
  const today = todayISO()
  const s = useSubscriptions()
  const toast = useToast()
  const setIgnored = useSetIgnoredSubscriptions()
  const [open, setOpen] = useState<Subscription | null>(null)
  const [draft, setDraft] = useState<RecurringDraft | null>(null)

  const active = s.subs?.filter((x) => x.status === 'active') ?? []
  const possible = s.subs?.filter((x) => x.status === 'possible') ?? []
  const ended = s.subs?.filter((x) => x.status === 'ended') ?? []
  // Under to måneder med historikk er det for lite til å se mønstre
  const thinHistory = !s.oldestDate || s.oldestDate > addDays(today, -60)

  async function saveIgnored(keys: string[], text: string, undo?: string[]) {
    try {
      await setIgnored.mutateAsync({ userId: app.userId, keys })
      toast({ text, action: undo ? { label: 'Angre', run: () => setIgnored.mutate({ userId: app.userId, keys: undo }) } : undefined })
    } catch (err) {
      toast({ text: errorMessage(err), tone: 'error' })
    }
  }

  function ignore(sub: Subscription) {
    const key = ignoreKeyOf(sub)
    setOpen(null)
    void saveIgnored([...new Set([...s.ignored, key])], `${sub.name.replace(/ \(\d+ kr\)$/, '')} vises ikke lenger her`, s.ignored)
  }

  function makeFixed(sub: Subscription) {
    const latest = s.txs.find((t) => t.id === sub.charges[0].id)
    setOpen(null)
    setDraft({ draft: {
      kind: 'expense', merchant: sub.name.replace(/ \(\d+ kr\)$/, ''), amount_ore: sub.amountOre,
      day_of_month: Number(sub.lastDate.slice(8, 10)),
      // Starter ved neste trekk, så det som alt er ført ikke kommer dobbelt
      start_on: sub.nextDate < today ? today : sub.nextDate,
      category_id: latest?.category_id ?? null, account_id: latest?.account_id ?? app.defaultAccountId, note: null,
    } })
  }

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 pt-4 md:pt-8">
      <Link to="/" className="text-sm font-semibold text-accent">Oversikt</Link>
      <h1 className="text-2xl font-bold tracking-tight mt-1">Abonnementer</h1>

      {s.error && <p className="text-bad mt-6">Klarte ikke å hente transaksjoner. {s.error.message}</p>}
      {s.loading && <p className="text-muted mt-8">Leter gjennom transaksjonene…</p>}

      {s.subs && (
        <>
          <section aria-labelledby="sum" className="mt-5 rounded-xl bg-surface p-5">
            <h2 id="sum" className="text-muted">Abonnementer koster deg</h2>
            <p className="mt-1"><span className="num text-4xl font-bold tracking-tight">{formatOre(s.subsMonthlyOre, { decimals: 'never' })}</span><span className="text-muted"> i måneden</span></p>
            <p className="mt-1">Det blir <span className="num font-semibold">{formatOre(s.subsMonthlyOre * 12, { decimals: 'never' })}</span> i året{s.subsCount ? <>, fordelt på {s.subsCount}</> : null}.</p>
            {s.totalMonthlyOre > s.subsMonthlyOre && (
              <p className="text-sm text-muted mt-2">
                Med husleie og andre faste poster trekkes det <span className="num text-ink font-medium">{formatOre(s.totalMonthlyOre, { decimals: 'never' })}</span> i måneden.
              </p>
            )}
          </section>

          {thinHistory && (
            <div className="mt-4 rounded-xl bg-accent-soft px-4 py-3 text-sm">
              <p>Jeg finner abonnementer ved å se etter ting som trekkes med jevne mellomrom, så jeg trenger noen måneder med historikk.
                Last inn kontoutskriften fra DNB for det siste året, så dukker de opp her.</p>
              <Link to="/import" className="inline-block mt-2 font-semibold text-accent">Importer fra banken</Link>
            </div>
          )}

          <Section id="funnet" title="Funnet i transaksjonene" count={active.length}>
            {active.length === 0
              ? <Empty>{thinHistory ? 'Ingenting ennå. Det trengs minst to trekk for å se et mønster.' : 'Fant ingen faste trekk utenom de faste postene dine.'}</Empty>
              : <List items={active} today={today} onOpen={setOpen} />}
          </Section>

          {possible.length > 0 && (
            <Section id="kanskje" title="Kanskje" intro="Kjente tjenester som bare er trukket én gang så langt. Telles ikke med i summen før de kommer igjen.">
              <List items={possible} today={today} onOpen={setOpen} />
            </Section>
          )}

          {s.fixed.length > 0 && (
            <Section id="faste" title="Lagt inn som faste poster" action={<Link to="/faste" className="text-sm font-semibold text-accent">Endre</Link>}>
              <ul className="rounded-xl bg-surface divide-y divide-line">
                {s.fixed.map((r) => <FixedRow key={r.id} r={r} />)}
              </ul>
            </Section>
          )}

          {ended.length > 0 && (
            <Section id="avsluttet" title="Ser ut til å være avsluttet" intro="Har ikke blitt trukket på en stund. Har du sagt dem opp, er alt som det skal.">
              <List items={ended} today={today} onOpen={setOpen} muted />
            </Section>
          )}

          {s.ignored.length > 0 && (
            <Section id="skjult" title="Skjult" intro="Ting du har sagt ikke er abonnement.">
              <ul className="rounded-xl bg-surface divide-y divide-line">
                {s.ignored.map((k) => (
                  <li key={k} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="flex-1 truncate capitalize">{k.replace(/^[kn]:/, '')}</span>
                    <button className="btn btn-ghost" disabled={setIgnored.isPending}
                      onClick={() => saveIgnored(s.ignored.filter((x) => x !== k), 'Vises igjen hvis den trekkes jevnlig')}>Vis igjen</button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      <Details sub={open} txs={s.txs} today={today} onClose={() => setOpen(null)} onIgnore={ignore} onMakeFixed={makeFixed} />
      <RecurringEditor target={draft} onClose={() => setDraft(null)} />
    </div>
  )
}

function addDays(iso: string, n: number) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n))
  return d.toISOString().slice(0, 10)
}

function Section({ id, title, intro, count, action, children }: { id: string; title: string; intro?: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="font-bold text-lg">{title}{count ? <span className="text-muted font-normal"> {count}</span> : null}</h2>
        {action}
      </div>
      {intro && <p className="text-sm text-muted mt-1">{intro}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-xl bg-surface p-4 text-muted">{children}</p>

function List({ items, today, onOpen, muted }: { items: Subscription[]; today: string; onOpen: (s: Subscription) => void; muted?: boolean }) {
  return (
    <ul className="rounded-xl bg-surface divide-y divide-line">
      {items.map((sub) => (
        <li key={sub.key}>
          <button className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-sunken rounded-xl ${muted ? 'opacity-70' : ''}`} onClick={() => onOpen(sub)}>
            <Monogram name={sub.name} />
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{sub.name}</span>
                {sub.priceChange && sub.priceChange.toOre > sub.priceChange.fromOre && sub.status !== 'ended' && (
                  <span className="shrink-0 rounded-full bg-warn/15 text-warn text-xs font-semibold px-2 py-0.5">Dyrere</span>
                )}
              </span>
              <span className="block truncate text-sm text-muted">
                {sub.status === 'ended' ? `Sist trukket ${formatDate(sub.lastDate, today)}`
                  : sub.status === 'possible' ? `Trukket ${formatDate(sub.lastDate, today)}`
                  : `${cap(FREQ_LABEL[sub.frequency])} · neste ${formatDate(sub.nextDate, today)}`}
              </span>
            </span>
            <span className="text-right whitespace-nowrap">
              <span className="block num font-semibold">{kr(sub.amountOre)}</span>
              {sub.status !== 'ended' && <span className="block num text-xs text-muted">{formatOre(sub.yearlyOre, { decimals: 'never' })} i året</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function FixedRow({ r }: { r: Recurring }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Monogram name={r.merchant} />
      <span className="flex-1 min-w-0">
        <span className="block truncate font-medium">{r.merchant}</span>
        <span className="block text-sm text-muted">Hver måned · {r.day_of_month === 31 ? 'siste dag' : `den ${r.day_of_month}.`}</span>
      </span>
      <span className="text-right whitespace-nowrap">
        <span className="block num font-semibold">{kr(r.amount_ore)}</span>
        <span className="block num text-xs text-muted">{formatOre(r.amount_ore * 12, { decimals: 'never' })} i året</span>
      </span>
    </li>
  )
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Forbokstav i en farget sirkel. Fargen følger navnet, så samme tjeneste alltid ser lik ut. */
function Monogram({ name }: { name: string }) {
  let h = 0
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360
  return (
    <span aria-hidden="true" className="size-9 shrink-0 rounded-full grid place-items-center font-bold text-sm"
      style={{ background: `hsl(${h} 55% 50% / 0.22)` }}>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

function Details({ sub, txs, today, onClose, onIgnore, onMakeFixed }: {
  sub: Subscription | null; txs: Transaction[]; today: string; onClose: () => void; onIgnore: (s: Subscription) => void; onMakeFixed: (s: Subscription) => void
}) {
  const { setEditor } = useApp()
  // Beholder innholdet mens arket lukker seg
  const [last, setLast] = useState<Subscription | null>(null)
  if (sub && sub !== last) setLast(sub)
  const d = sub ?? last
  if (!d) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>
  const up = d.priceChange && d.priceChange.toOre > d.priceChange.fromOre

  return (
    <Sheet open={!!sub} onClose={onClose} title={d.name}>
      <div className="space-y-5">
        <div>
          <p><span className="num text-3xl font-bold">{kr(d.amountOre)}</span> <span className="text-muted">{FREQ_LABEL[d.frequency]}</span></p>
          {d.status !== 'ended' && <p className="text-muted mt-1">Det blir <span className="num text-ink font-semibold">{formatOre(d.yearlyOre, { decimals: 'never' })}</span> i året.</p>}
        </div>

        {d.priceChange && (
          <p className={`rounded-lg px-3 py-2 text-sm ${up ? 'bg-warn/15' : 'bg-good/15'}`}>
            Prisen {up ? 'gikk opp' : 'gikk ned'} fra <span className="num font-semibold">{kr(d.priceChange.fromOre)}</span> til <span className="num font-semibold">{kr(d.priceChange.toOre)}</span> {formatDate(d.priceChange.since, today)}.
            {up && d.frequency !== 'year' && <> Det er {formatOre((d.priceChange.toOre - d.priceChange.fromOre) * (d.frequency === 'month' ? 12 : 4), { decimals: 'never' })} mer i året.</>}
          </p>
        )}

        <dl className="rounded-xl bg-sunken px-4 divide-y divide-line">
          <Row label="Sist trukket" value={formatDate(d.lastDate, today)} />
          {d.status === 'ended'
            ? <Row label="Status" value="Ikke trukket siden" />
            : <Row label={d.status === 'possible' ? 'Neste, hvis månedlig' : 'Neste trekk ventes'} value={formatDate(d.nextDate, today)} />}
          <Row label="Antall trekk" value={String(d.charges.length)} />
        </dl>

        <div>
          <h3 className="font-semibold mb-1">Trekk</h3>
          <ul className="divide-y divide-line">
            {d.charges.slice(0, 13).map((c) => {
              const tx = txs.find((t) => t.id === c.id)
              return (
                <li key={c.id}>
                  <button className="w-full flex justify-between gap-3 py-2 text-left hover:bg-sunken rounded px-1" disabled={!tx}
                    onClick={() => { if (tx) { onClose(); setEditor({ type: 'edit', tx }) } }}>
                    <span>{formatDate(c.date, today)}</span><span className="num">{kr(c.amountOre)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="space-y-2 pt-2 border-t border-line">
          {d.frequency === 'month' && d.status !== 'ended' && (
            <>
              <button className="btn btn-primary w-full" onClick={() => onMakeFixed(d)}>Gjør til fast post</button>
              <p className="text-xs text-muted">Da kommer den med i anslaget for måneden fra dag én, og registreres automatisk fra neste trekk.</p>
            </>
          )}
          <button className="btn btn-ghost w-full" onClick={() => onIgnore(d)}>Ikke et abonnement</button>
        </div>
      </div>
    </Sheet>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 py-2.5"><dt className="text-muted">{label}</dt><dd className="font-medium">{value}</dd></div>
}
