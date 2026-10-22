// Abonnementsjeger: finner ting som trekkes jevnlig ut fra transaksjonshistorikken.
// Ren logikk uten nettverk, så den kan testes.
import { daysBetweenInclusive, daysInMonth, monthOf, shiftMonth } from './dates'
import { KIND_EFFECT, type TxKind } from './finance'

export type Frequency = 'month' | 'quarter' | 'year'

export const FREQ_LABEL: Record<Frequency, string> = { month: 'hver måned', quarter: 'hvert kvartal', year: 'hvert år' }
const FREQ_MONTHS: Record<Frequency, number> = { month: 1, quarter: 3, year: 12 }
/** Hvor mange dager etter forventet trekk vi venter før vi tror den er avsluttet */
const GRACE_DAYS: Record<Frequency, number> = { month: 15, quarter: 25, year: 35 }

/** Kjente tjenester. Gir pent navn, og gjør at ett enkelt trekk kan vises som et mulig abonnement. */
export const KNOWN_SERVICES: { name: string; pattern: RegExp }[] = [
  { name: 'Netflix', pattern: /\bnetflix/ },
  { name: 'Spotify', pattern: /\bspotify/ },
  { name: 'Viaplay', pattern: /\bviaplay/ },
  { name: 'Max', pattern: /\b(hbo|max\.com|hbomax)/ },
  { name: 'Disney+', pattern: /\bdisney/ },
  { name: 'TV 2 Play', pattern: /\btv ?2\b/ },
  { name: 'Discovery+', pattern: /\bdiscovery/ },
  { name: 'SkyShowtime', pattern: /\bskyshowtime/ },
  { name: 'Amazon Prime', pattern: /\b(prime ?video|amazon prime|amzn prime)/ },
  { name: 'YouTube Premium', pattern: /\byoutube/ },
  { name: 'Apple', pattern: /\b(apple\.com|apple services|itunes|icloud)/ },
  { name: 'Google', pattern: /\bgoogle (one|storage|play)/ },
  { name: 'Tidal', pattern: /\btidal\b/ },
  { name: 'Storytel', pattern: /\bstorytel/ },
  { name: 'BookBeat', pattern: /\bbookbeat/ },
  { name: 'Nextory', pattern: /\bnextory/ },
  { name: 'Audible', pattern: /\baudible/ },
  { name: 'Adobe', pattern: /\badobe/ },
  { name: 'Microsoft 365', pattern: /\b(microsoft|msft)/ },
  { name: 'Dropbox', pattern: /\bdropbox/ },
  { name: 'ChatGPT', pattern: /\b(openai|chatgpt)/ },
  { name: 'Claude', pattern: /\b(anthropic|claude\.ai)/ },
  { name: 'PlayStation Plus', pattern: /\b(playstation|sony interactive)/ },
  { name: 'Xbox', pattern: /\bxbox/ },
  { name: 'Nintendo', pattern: /\bnintendo/ },
  { name: 'Strava', pattern: /\bstrava/ },
  { name: 'Duolingo', pattern: /\bduolingo/ },
  { name: 'LinkedIn', pattern: /\blinkedin/ },
  { name: 'Patreon', pattern: /\bpatreon/ },
  { name: 'Wolt+', pattern: /\bwolt ?\+|wolt plus/ },
  { name: 'SATS', pattern: /\bsats\b/ },
  { name: 'Fresh Fitness', pattern: /\bfresh fitness/ },
  { name: 'EVO', pattern: /\bevo (fitness|treningssenter)/ },
  { name: 'Elixia', pattern: /\belixia/ },
  { name: 'Telia', pattern: /\btelia/ },
  { name: 'Telenor', pattern: /\btelenor/ },
  { name: 'Ice', pattern: /\bice (norge|communication|\.no)/ },
  { name: 'Talkmore', pattern: /\btalkmore/ },
  { name: 'OneCall', pattern: /\bonecall/ },
  { name: 'Chili Mobil', pattern: /\bchili ?mobil/ },
  { name: 'Altibox', pattern: /\baltibox/ },
  { name: 'VG+', pattern: /\bvg ?\+|\bvg pluss/ },
  { name: 'Aftenposten', pattern: /\baftenposten/ },
  { name: 'Dagens Næringsliv', pattern: /\bdagens n(æ|ae)ringsliv|\bdn\.no/ },
  { name: 'Amedia', pattern: /\bamedia/ },
]

export function knownService(name: string): string | null {
  const s = ` ${name.toLowerCase()} `
  return KNOWN_SERVICES.find((k) => k.pattern.test(s))?.name ?? null
}

/**
 * Nøkkel som samler samme tjeneste selv om teksten fra banken varierer litt fra måned til måned,
 * for eksempel "Spotify P2A8C1D3" og "SPOTIFY P5F0B2E9".
 */
export function subscriptionKey(name: string): string {
  const known = knownService(name)
  if (known) return `k:${known.toLowerCase()}`
  const words = name.toLowerCase()
    .replace(/\.(com|no|se|io|net)\b/g, ' ')
    .replace(/[^\p{L}\p{N}+ ]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !/\d/.test(w))
  return `n:${words.slice(0, 2).join(' ')}`
}

export interface ChargeLike {
  id: string
  kind: TxKind
  amount_ore: number
  occurred_on: string
  merchant_id: string | null
  description: string | null
  recurring_id?: string | null
}

export interface Subscription {
  key: string
  name: string
  frequency: Frequency
  /** active: trekkes fortsatt. possible: bare sett én gang, men er en kjent tjeneste. ended: har ikke kommet på en stund. */
  status: 'active' | 'possible' | 'ended'
  /** Siste beløp */
  amountOre: number
  monthlyOre: number
  yearlyOre: number
  lastDate: string
  /** Når neste trekk ventes */
  nextDate: string
  /** Trekkene, nyeste først */
  charges: { id: string; date: string; amountOre: number }[]
  /** Satt når prisen har gått opp eller ned i perioden */
  priceChange: { fromOre: number; toOre: number; since: string } | null
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const days = (a: string, b: string) => daysBetweenInclusive(a, b) - 1

/** Samme dag et antall måneder fram. Dag 31 blir siste dag i korte måneder. */
export function addMonths(iso: string, n: number): string {
  const m = shiftMonth(monthOf(iso), n)
  const d = Math.min(+iso.slice(8, 10), daysInMonth(m))
  return `${m.year}-${String(m.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Hvor nær et intervall er en hel periode. Tillater at en måned mangler i historikken. */
function fitsPeriod(interval: number, freq: Frequency): boolean {
  if (freq === 'year') return interval >= 350 && interval <= 380
  if (freq === 'quarter') return interval >= 84 && interval <= 98
  // Én til tre måneder, med en uke slingring per måned
  for (let k = 1; k <= 3; k++) {
    const centre = 30.44 * k
    if (Math.abs(interval - centre) <= 4 + 3 * k) return true
  }
  return false
}

/** Deler en tjenestes trekk i grupper med lignende beløp, så f.eks. to ulike Apple-abonnement holdes fra hverandre. */
function clusterByAmount<T extends { amount_ore: number }>(sorted: T[]): T[][] {
  const clusters: T[][] = []
  for (const c of sorted) {
    const fit = clusters.find((cl) => {
      const last = cl[cl.length - 1].amount_ore
      return Math.abs(c.amount_ore - last) <= Math.max(500, last * 0.2)
    })
    if (fit) fit.push(c)
    else clusters.push([c])
  }
  return clusters
}

function classify(charges: { occurred_on: string; amount_ore: number }[], known: boolean): Frequency | 'possible' | null {
  if (charges.length === 1) return known ? 'possible' : null
  const intervals = charges.slice(1).map((c, i) => days(charges[i].occurred_on, c.occurred_on))
  const amounts = charges.map((c) => c.amount_ore)
  const spread = (Math.max(...amounts) - Math.min(...amounts)) / Math.max(...amounts)
  for (const freq of ['month', 'quarter', 'year'] as Frequency[]) {
    if (!intervals.every((iv) => fitsPeriod(iv, freq))) continue
    if (freq === 'month' && median(intervals) > 45) continue
    // To trekk er tynt grunnlag. Da må beløpet være likt, eller tjenesten kjent.
    if (charges.length === 2 && !known && spread > 0.01) continue
    if (freq === 'year' && !known && spread > 0.1) continue
    return freq
  }
  return null
}

/**
 * Finner abonnementer og andre faste trekk.
 * Transaksjoner fra faste poster hoppes over, de vises for seg. ignoredKeys er ting du har sagt ikke er abonnement.
 */
export function findSubscriptions(
  txs: ChargeLike[],
  merchantNameById: Map<string, string>,
  today: string,
  opts: { ignoredKeys?: Iterable<string>; skipKeys?: Iterable<string> } = {},
): Subscription[] {
  const ignored = new Set(opts.ignoredKeys ?? [])
  const skip = new Set(opts.skipKeys ?? [])
  const groups = new Map<string, { name: string; charges: ChargeLike[] }>()

  for (const t of txs) {
    if (t.recurring_id) continue
    if (KIND_EFFECT[t.kind].spending !== 1 || t.occurred_on > today) continue
    const name = (t.merchant_id ? merchantNameById.get(t.merchant_id) : null) ?? t.description ?? ''
    if (!name.trim()) continue
    const key = subscriptionKey(name)
    if (key === 'n:' || ignored.has(key) || skip.has(key)) continue
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { name, charges: [] }))
    g.charges.push(t)
  }

  const out: Subscription[] = []
  for (const [key, g] of groups) {
    const known = knownService(g.name)
    const sorted = [...g.charges].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.id.localeCompare(b.id))
    const clusters = clusterByAmount(sorted)
    clusters.forEach((cl, idx) => {
      const kind = classify(cl, !!known)
      if (!kind) return
      const freq: Frequency = kind === 'possible' ? 'month' : kind
      const last = cl[cl.length - 1]
      const first = cl[0]
      const nextDate = addMonths(last.occurred_on, FREQ_MONTHS[freq])
      const overdue = days(nextDate, today) > GRACE_DAYS[freq]
      const status = overdue ? 'ended' : kind === 'possible' ? 'possible' : 'active'
      // Prisendring vises bare når beløpet har ligget fast, ikke for regninger som varierer hver gang
      const distinct = new Set(cl.map((c) => c.amount_ore)).size
      const changed = cl.length >= 2 && distinct <= 3 && Math.abs(last.amount_ore - first.amount_ore) >= 100
      let i = cl.length - 1
      while (i > 0 && cl[i - 1].amount_ore === last.amount_ore) i--
      const since = cl[i].occurred_on
      out.push({
        key: clusters.length > 1 ? `${key}#${idx}` : key,
        name: known ?? prettyName(g.name),
        frequency: freq,
        status,
        amountOre: last.amount_ore,
        monthlyOre: Math.round(last.amount_ore / FREQ_MONTHS[freq]),
        yearlyOre: last.amount_ore * (12 / FREQ_MONTHS[freq]),
        lastDate: last.occurred_on,
        nextDate,
        charges: [...cl].reverse().map((c) => ({ id: c.id, date: c.occurred_on, amountOre: c.amount_ore })),
        priceChange: changed ? { fromOre: first.amount_ore, toOre: last.amount_ore, since } : null,
      })
    })
  }

  // Samme tjeneste i flere beløpsgrupper får beløpet i navnet, så de kan skilles
  const nameCount = new Map<string, number>()
  for (const s of out) nameCount.set(s.name, (nameCount.get(s.name) ?? 0) + 1)
  for (const s of out) if ((nameCount.get(s.name) ?? 0) > 1) s.name = `${s.name} (${Math.round(s.amountOre / 100)} kr)`

  return out.sort((a, b) => b.yearlyOre - a.yearlyOre || a.name.localeCompare(b.name))
}

/** "NETFLIX.COM" blir "Netflix.com". Tekst med små bokstaver fra før beholdes. */
function prettyName(s: string): string {
  const t = s.trim()
  if (t !== t.toUpperCase()) return t
  return t.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
}

export interface SubscriptionTotals {
  monthlyOre: number
  yearlyOre: number
  count: number
}

export function totals(subs: Pick<Subscription, 'status' | 'monthlyOre' | 'yearlyOre'>[]): SubscriptionTotals {
  const active = subs.filter((s) => s.status === 'active')
  return {
    monthlyOre: active.reduce((a, s) => a + s.monthlyOre, 0),
    yearlyOre: active.reduce((a, s) => a + s.yearlyOre, 0),
    count: active.length,
  }
}

/** Nøkkelen som lagres når du sier at noe ikke er et abonnement. Gjelder hele tjenesten. */
export const ignoreKeyOf = (s: Pick<Subscription, 'key'>) => s.key.split('#')[0]
