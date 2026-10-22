// Leser kontoutskrift fra banken (DNB) og gjør den om til rader som kan importeres.
// Tåler både eldre filer (semikolon, Windows-tegnsett) og nyere (UTF-8, komma eller tab).
import { parseAmountToOre, normalizeMerchant } from './money'

export interface BankRow {
  /** Linjenummer i filen, for feilmeldinger */
  line: number
  date: string
  /** Positivt beløp i øre */
  amountOre: number
  direction: 'out' | 'in'
  /** Teksten fra banken, uendret */
  description: string
}

export interface ParseResult {
  rows: BankRow[]
  /** Linjer som ikke kunne leses, med grunn */
  skipped: { line: number; reason: string }[]
}

/** Leser filen som UTF-8, og faller tilbake på Windows-tegnsett (eldre DNB-filer) hvis det ikke går. */
export function decodeBankFile(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

/** Enkel CSV-leser som forstår anførselstegn og linjeskift inne i felt. */
export function parseCsv(text: string, sep: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === sep) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); out.push(row); row = []; field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) { row.push(field); out.push(row) }
  return out
}

function detectSeparator(headerLine: string): string {
  const counts = [';', '\t', ','].map((s) => [s, headerLine.split(s).length - 1] as const)
  return counts.sort((a, b) => b[1] - a[1])[0][0]
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

function parseDate(s: string): string | null {
  const t = s.trim()
  let m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return valid(y, Number(m[2]), Number(m[1]))
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]))
  return null
}

function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Beløp fra banken. Fortegn tas vare på, og tomt felt gir null. */
function parseSigned(s: string): number | null {
  const t = s.trim().replace(/\s/g, '').replace(/^\+/, '')
  if (!t) return null
  const neg = t.startsWith('-') || t.startsWith('−')
  const ore = parseAmountToOre(neg ? t.slice(1) : t)
  if (ore === null) return null
  return neg ? -ore : ore
}

export function parseBankCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/)
  // Overskriftslinjen har en kolonne som heter "Dato" eller slutter på "dato" ("Bokført dato", "Transaksjonsdato")
  const headerIdx = lines.findIndex((l) =>
    l.split(/[;,\t]/).some((f) => /dato$/i.test(f.replace(/"/g, '').trim())))
  if (headerIdx < 0) throw new Error('Fant ikke kolonneoverskriftene. Er dette en kontoutskrift fra nettbanken, lagret som CSV?')
  const sep = detectSeparator(lines[headerIdx])
  const table = parseCsv(lines.slice(headerIdx).join('\n'), sep)
  const header = table[0].map(norm)

  const find = (test: (h: string) => boolean) => header.findIndex(test)
  const isDate = (h: string) => /dato$/.test(h) || h.startsWith('dato')
  // Kjøpsdatoen foretrekkes framfor bokføringsdatoen, og rentedato brukes aldri
  const cDate = [
    (h: string) => h === 'transaksjonsdato' || h === 'dato',
    (h: string) => h === 'bokført dato' || h === 'bokføringsdato',
    (h: string) => isDate(h) && !h.includes('rente'),
  ].map(find).find((i) => i >= 0) ?? -1
  const cDesc = [
    (h: string) => /forklaring|beskrivelse|tekst|mottaker/.test(h),
    (h: string) => /transaksjon/.test(h) && !isDate(h),
  ].map(find).find((i) => i >= 0) ?? -1
  const cOut = find((h) => /uttak|ut fra|ut av|^ut$|belastet/.test(h))
  const cIn = find((h) => /innskudd|inn på|^inn$|godskrevet/.test(h))
  const cAmount = find((h) => /^beløp|^belop|^amount/.test(h))

  if (cDate < 0 || cDesc < 0 || (cAmount < 0 && (cOut < 0 || cIn < 0))) {
    throw new Error('Filen har ikke kolonnene appen trenger (dato, forklaring og beløp ut og inn).')
  }

  const rows: BankRow[] = []
  const skipped: ParseResult['skipped'] = []
  for (let i = 1; i < table.length; i++) {
    const r = table[i]
    const line = headerIdx + i + 1
    if (r.every((c) => c.trim() === '')) continue
    const date = parseDate(r[cDate] ?? '')
    if (!date) { skipped.push({ line, reason: 'ugyldig dato' }); continue }
    const description = (r[cDesc] ?? '').trim().replace(/\s+/g, ' ')

    let signed: number | null
    if (cOut >= 0 && cIn >= 0) {
      const out = parseSigned(r[cOut] ?? '')
      const inn = parseSigned(r[cIn] ?? '')
      signed = out ? -Math.abs(out) : inn ? Math.abs(inn) : null
    } else {
      signed = parseSigned(r[cAmount] ?? '')
    }
    if (!signed) { skipped.push({ line, reason: 'mangler beløp' }); continue }
    rows.push({ line, date, amountOre: Math.abs(signed), direction: signed < 0 ? 'out' : 'in', description })
  }
  return { rows, skipped }
}

/**
 * Lager et butikknavn av bankteksten.
 * "Varekjøp REMA 1000 LILLESTRØM Dato 18.10" -> "REMA 1000 LILLESTRØM"
 * "Visa 123456 *1234 18.10 NOK 249,00 NARVESEN Kurs: 1.0000" -> "NARVESEN"
 */
export function cleanMerchant(description: string): string {
  // "Til : 1234.56.78901" og lignende er overføringer til en konto, ikke en butikk
  if (/^\s*(Til|Fra)\s*:?\s*[\d.\s]*$/i.test(description)) return /^\s*Fra/i.test(description) ? 'Overføring inn' : 'Overføring ut'
  let s = ` ${description} `
  s = s.replace(/\s(Dato|Kurs|Valutakurs|Betalt|Bokført)\b.*$/i, ' ')
  s = s.replace(/\s(Varekjøp|Varekjop|Kortkjøp|Visa|Reservert|Kontaktløs|Betaling|Nettgiro|Giro|Til|Fra)(?=\s)/gi, ' ')
  s = s.replace(/\s\*\d{2,}/g, ' ')                     // *1234 kortnummer
  s = s.replace(/\s\d{1,2}\.\d{1,2}(\.\d{2,4})?(?=\s)/g, ' ') // datoer
  s = s.replace(/\s(NOK|SEK|EUR|USD|DKK|GBP)\s[\d.,]+/gi, ' ')
  s = s.replace(/\s\d{6,}(?=\s)/g, ' ')                  // lange referanser og kontonumre
  s = s.replace(/\sUbr\*?\s*Pending\.Uber\.Com/i, ' Uber')
  // Betalingsformidlere foran butikknavnet: "Vipps*Ruter", "Aer*Kiwi 333", "Vfi*Holdbart"
  s = s.replace(/^\s*(Vipps|Aer|Vfi|Sumup|Zettle_?|Iz|Sq|Pp)\s*\*\s*/i, ' ')
  s = s.replace(/\*/g, ' ')
  s = s.replace(/[\s-]+$/, '')
  s = s.replace(/\s+/g, ' ').trim()
  return (s || description.trim()).slice(0, 80)
}

/**
 * Bruker en butikk du har fra før hvis bankteksten starter med navnet,
 * så "REMA 1000 LILLESTRØM" havner på "REMA 1000" og ikke blir en ny butikk.
 */
export function matchKnownMerchant(cleaned: string, known: { name: string; normalized_name: string }[]): string {
  const q = normalizeMerchant(cleaned)
  let best: { name: string; normalized_name: string } | undefined
  for (const m of known) {
    if (m.normalized_name.length < 3) continue
    if (q === m.normalized_name || q.startsWith(m.normalized_name + ' ')) {
      if (!best || m.normalized_name.length > best.normalized_name.length) best = m
    }
  }
  return best?.name ?? cleaned
}

/** Nøkkel som kjenner igjen samme bankrad hvis filen importeres på nytt. */
export async function importKeys(rows: BankRow[]): Promise<string[]> {
  const seen = new Map<string, number>()
  const keys: string[] = []
  for (const r of rows) {
    const base = `${r.date}|${r.direction}|${r.amountOre}|${normalizeMerchant(r.description)}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    const bytes = new TextEncoder().encode(`${base}|${n}`)
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    keys.push('bank:' + [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join(''))
  }
  return keys
}

export interface ExistingTx {
  id: string
  amount_ore: number
  occurred_on: string
  import_key?: string | null
}

/**
 * Finner rader som trolig allerede er ført for hånd: samme beløp, høyst tre dager fra hverandre.
 * Hver eksisterende transaksjon kan bare brukes én gang. Returnerer indeksene til slike rader.
 */
export function likelyDuplicates(rows: BankRow[], existing: ExistingTx[]): Set<number> {
  const used = new Set<string>()
  const dup = new Set<number>()
  const dayNum = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000
  rows.forEach((r, i) => {
    let best: ExistingTx | undefined
    let bestGap = Infinity
    for (const e of existing) {
      if (e.import_key || used.has(e.id) || e.amount_ore !== r.amountOre) continue
      const gap = Math.abs(dayNum(e.occurred_on) - dayNum(r.date))
      if (gap <= 3 && gap < bestGap) { best = e; bestGap = gap }
    }
    if (best) { used.add(best.id); dup.add(i) }
  })
  return dup
}

const TRANSFER_TEXT = /^\s*(til|fra)\s*:|^\s*innbetaling\s*$|overføring|overforing|nedbetaling kredittkort/i

/**
 * Finner rader som trolig er penger mellom dine egne kontoer, for eksempel nedbetaling av kredittkortet:
 * "Til : konto" ut fra brukskontoen og "Innbetaling" inn på kortet.
 *
 * Svaret per radnummer:
 *  - "transfer": føres som overføring
 *  - "mirror":   samme overføring sett fra den andre kontoen i samme fil, skal ikke føres en gang til
 */
export function likelyTransfers(rows: BankRow[]): Map<number, 'transfer' | 'mirror'> {
  const out = new Map<number, 'transfer' | 'mirror'>()
  const dayNum = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000
  const looks = rows.map((r) => TRANSFER_TEXT.test(r.description))
  rows.forEach((r, i) => {
    if (out.has(i) || r.direction !== 'out') return
    let best = -1
    let bestGap = Infinity
    rows.forEach((o, j) => {
      if (out.has(j) || o.direction !== 'in' || o.amountOre !== r.amountOre) return
      if (!looks[i] && !looks[j]) return
      const gap = Math.abs(dayNum(o.date) - dayNum(r.date))
      if (gap <= 2 && gap < bestGap) { best = j; bestGap = gap }
    })
    if (best >= 0) { out.set(i, 'transfer'); out.set(best, 'mirror') }
  })
  // Overføringer der den andre siden ikke er i filen
  rows.forEach((_, i) => { if (!out.has(i) && looks[i]) out.set(i, 'transfer') })
  return out
}
