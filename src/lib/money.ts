// Penger håndteres alltid som heltall i øre. Ingen flyttall i beregninger.

const NBSP = /[\s  ]/g

/**
 * Tolker et beløp skrevet slik folk skriver det i Norge og returnerer øre.
 * Godtar blant annet: 249, 249,5, 249,50, 1 249,50, 1.249,50, 1249.50, 249 kr.
 * Returnerer null hvis teksten ikke er et gyldig positivt beløp.
 */
export function parseAmountToOre(input: string): number | null {
  let s = input.trim().replace(/(kr|nok|,-)\.?$/i, '').replace(NBSP, '')
  if (!s || !/^\d[\d.,]*$/.test(s)) return null

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let intPart: string
  let decPart = ''

  if (lastComma >= 0 && lastDot >= 0) {
    // Begge finnes: det siste tegnet er desimalskilletegnet.
    const decIdx = Math.max(lastComma, lastDot)
    const thousandSep = decIdx === lastComma ? '.' : ','
    intPart = s.slice(0, decIdx)
    decPart = s.slice(decIdx + 1)
    const grouped = thousandSep === '.' ? /^\d{1,3}(\.\d{3})*$/ : /^\d{1,3}(,\d{3})*$/
    if (!grouped.test(intPart)) return null
    intPart = intPart.split(thousandSep).join('')
  } else if (lastComma >= 0) {
    // Bare komma: norsk desimalkomma.
    if (s.indexOf(',') !== lastComma) return null
    intPart = s.slice(0, lastComma)
    decPart = s.slice(lastComma + 1)
  } else if (lastDot >= 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      intPart = s.replace(/\./g, '') // 1.249 = tusenskille
    } else if (s.indexOf('.') === lastDot) {
      intPart = s.slice(0, lastDot)
      decPart = s.slice(lastDot + 1)
    } else {
      return null
    }
  } else {
    intPart = s
  }

  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(decPart)) return null
  const ore = Number(intPart) * 100 + Number(decPart.padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(ore) || ore <= 0 || ore >= 100_000_000_000) return null
  return ore
}

/** 124950 -> "1 249,50 kr". Bygget fra heltall, ikke via flyttall. */
export function formatOre(ore: number, opts: { sign?: boolean; decimals?: 'auto' | 'always' | 'never' } = {}): string {
  const { sign = false, decimals = 'auto' } = opts
  const neg = ore < 0
  // Uten desimaler rundes det av til nærmeste krone (50 øre og over rundes opp)
  const abs = decimals === 'never' ? Math.round(Math.abs(ore) / 100) * 100 : Math.abs(Math.round(ore))
  const kroner = Math.floor(abs / 100)
  const rest = abs % 100
  const grouped = String(kroner).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const showDec = decimals === 'always' || (decimals === 'auto' && rest !== 0)
  const body = showDec ? `${grouped},${String(rest).padStart(2, '0')}` : grouped
  const prefix = neg ? '−' : sign && ore > 0 ? '+' : ''
  return `${prefix}${body} kr`
}

/** For redigeringsfelt: 124950 -> "1249,50" */
export function oreToInput(ore: number): string {
  const kroner = Math.floor(ore / 100)
  const rest = ore % 100
  return rest === 0 ? String(kroner) : `${kroner},${String(rest).padStart(2, '0')}`
}

export interface QuickEntry {
  amountOre: number
  merchant: string
  /** true hvis brukeren skrev + foran beløpet, tolkes som inntekt */
  income: boolean
}

/**
 * "249 REMA" -> { amountOre: 24900, merchant: "REMA" }
 * Støtter også "REMA 249", "1 249,50 Elkjøp", "+25000 Lønn" og bare "249".
 */
export function parseQuickEntry(input: string): QuickEntry | null {
  const s = input.trim().replace(/\s+/g, ' ')
  if (!s) return null
  let income = false
  let rest = s
  if (rest.startsWith('+')) {
    income = true
    rest = rest.slice(1).trim()
  }

  // Beløp først: tall (med mellomrom som tusenskille) og så tekst som ikke starter med tall.
  const lead = rest.match(/^(\d[\d .,]*?)(?:\s?(?:kr|nok))?(?:\s+(\D.*))?$/i)
  if (lead) {
    const ore = parseAmountToOre(lead[1])
    if (ore !== null) return { amountOre: ore, merchant: (lead[2] ?? '').trim(), income }
  }

  // Beløp sist: "REMA 249" eller "Rema 1000 249,90"
  const trail = rest.match(/^(.*\S)\s+(\d[\d.,]*)(?:\s?(?:kr|nok))?$/i)
  if (trail && !income) {
    const ore = parseAmountToOre(trail[2])
    if (ore !== null) return { amountOre: ore, merchant: trail[1].trim(), income }
  }
  return null
}

export function normalizeMerchant(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase()
}
