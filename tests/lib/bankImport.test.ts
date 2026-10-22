import { describe, expect, it } from 'vitest'
import { cleanMerchant, decodeBankFile, importKeys, likelyDuplicates, likelyTransfers, matchKnownMerchant, parseBankCsv } from '../../src/lib/bankImport'

// Eldre DNB-format: semikolon, norsk dato, beløp ut og inn i hver sin kolonne
const DNB_OLD = [
  '"Dato";"Forklaring";"Rentedato";"Uttak";"Innskudd"',
  '"18.10.2026";"Varekjøp REMA 1000 LILLESTRØ LILLESTRØM Dato 17.10";"18.10.2026";"249,90";""',
  '"16.10.2026";"Visa 123456 *1234 15.10 NOK 89,00 NARVESEN Kurs: 1.0000";"16.10.2026";"89,00";""',
  '"15.10.2026";"Lønn ASPIA NORWAY AS";"15.10.2026";"";"35 000,00"',
  '"15.10.2026";"Varekjøp REMA 1000 LILLESTRØ LILLESTRØM Dato 14.10";"15.10.2026";"249,90";""',
  '',
].join('\r\n')

describe('parseBankCsv', () => {
  it('leser DNB sitt nye format med Transaksjonsdato og ISO-datoer', () => {
    const csv = 'Transaksjonsdato;Kontonummer;Beskrivelse;Ut av konto;Inn på konto;Valuta\r\n' +
      '2026-10-21;********;Innbetaling;;17631,42;NOK\r\n' +
      '2026-10-20;********;Www.Voiscooters.Com;7,5;;NOK\r\n' +
      '2026-10-19;********;Vipps*Vg+;99;;NOK\r\n'
    const r = parseBankCsv(csv)
    expect(r.skipped).toEqual([])
    expect(r.rows.map((x) => [x.date, x.direction, x.amountOre, x.description])).toEqual([
      ['2026-10-21', 'in', 1763142, 'Innbetaling'],
      ['2026-10-20', 'out', 750, 'Www.Voiscooters.Com'],
      ['2026-10-19', 'out', 9900, 'Vipps*Vg+'],
    ])
  })

  it('foretrekker kjøpsdato framfor bokført dato', () => {
    const r = parseBankCsv('Bokført dato;Transaksjonsdato;Forklaring;Ut;Inn\n20.10.2026;18.10.2026;REMA;10,00;\n')
    expect(r.rows[0].date).toBe('2026-10-18')
  })

  it('leser eldre DNB-fil', () => {
    const { rows, skipped } = parseBankCsv(DNB_OLD)
    expect(skipped).toEqual([])
    expect(rows.map((r) => [r.date, r.direction, r.amountOre])).toEqual([
      ['2026-10-18', 'out', 24990],
      ['2026-10-16', 'out', 8900],
      ['2026-10-15', 'in', 3500000],
      ['2026-10-15', 'out', 24990],
    ])
  })

  it('leser Windows-tegnsett (æøå)', () => {
    const bytes = new Uint8Array([...'Dato;Forklaring;Uttak;Innskudd\n01.10.2026;Kjøp på Bøk;10,00;\n'].map((c) => c.charCodeAt(0)))
    const text = decodeBankFile(bytes.buffer)
    expect(parseBankCsv(text).rows[0].description).toBe('Kjøp på Bøk')
  })

  it('leser nyere format med komma, punktum som desimal og fortegnsbeløp', () => {
    const text = 'Bokført dato,Beskrivelse,Beløp\n2026-10-02,"KIWI 505 STRØMMEN",-123.45\n2026-10-03,Vipps fra Ola,200.00\n'
    const { rows } = parseBankCsv(text)
    expect(rows.map((r) => [r.date, r.direction, r.amountOre, r.description])).toEqual([
      ['2026-10-02', 'out', 12345, 'KIWI 505 STRØMMEN'],
      ['2026-10-03', 'in', 20000, 'Vipps fra Ola'],
    ])
  })

  it('hopper over linjer med ugyldig dato og sier fra', () => {
    const { rows, skipped } = parseBankCsv('Dato;Forklaring;Uttak;Innskudd\nSaldo;;;\n01.10.2026;Kaffe;45,00;\n')
    expect(rows.length).toBe(1)
    expect(skipped).toEqual([{ line: 2, reason: 'ugyldig dato' }])
  })

  it('gir en forståelig feil for feil fil', () => {
    expect(() => parseBankCsv('hei;på;deg\n1;2;3')).toThrow(/kolonneoverskriftene/)
  })
})

describe('cleanMerchant', () => {
  it('rydder betalingsformidlere og rester fra DNB sitt nye format', () => {
    expect(cleanMerchant('Vipps*Ruter')).toBe('Ruter')
    expect(cleanMerchant('Vipps*Vg+')).toBe('Vg+')
    expect(cleanMerchant('Aer*Kiwi 333 Etterstad')).toBe('Kiwi 333 Etterstad')
    expect(cleanMerchant('Ubr* Pending.Uber.Com')).toBe('Uber')
    expect(cleanMerchant('Anthropic* Claude Sub')).toBe('Anthropic Claude Sub')
    expect(cleanMerchant('Matchi - 119612357')).toBe('Matchi')
    expect(cleanMerchant('Shopify* 603596991')).toBe('Shopify')
    expect(cleanMerchant('Rema 1000 Valle')).toBe('Rema 1000 Valle')
  })

  it.each([
    ['Varekjøp REMA 1000 LILLESTRØ LILLESTRØM Dato 17.10', 'REMA 1000 LILLESTRØ LILLESTRØM'],
    ['Visa 123456 *1234 15.10 NOK 89,00 NARVESEN Kurs: 1.0000', 'NARVESEN'],
    ['Lønn ASPIA NORWAY AS', 'Lønn ASPIA NORWAY AS'],
    ['Giro 86011234567 Lillestrøm kommune', 'Lillestrøm kommune'],
  ])('%s', (input, expected) => {
    expect(cleanMerchant(input)).toBe(expected)
  })
})

describe('matchKnownMerchant', () => {
  it('bruker eksisterende butikk når teksten starter med navnet', () => {
    const known = [{ name: 'REMA 1000', normalized_name: 'rema 1000' }, { name: 'Rema', normalized_name: 'rema' }]
    expect(matchKnownMerchant('REMA 1000 LILLESTRØM', known)).toBe('REMA 1000')
    expect(matchKnownMerchant('KIWI 505', known)).toBe('KIWI 505')
  })
})

describe('importKeys', () => {
  it('like rader samme dag får ulik nøkkel, og samme fil gir samme nøkler', async () => {
    const rows = parseBankCsv(DNB_OLD).rows
    const twice = [...rows, rows[0]]
    const a = await importKeys(twice)
    expect(new Set(a).size).toBe(5)
    expect(await importKeys(rows)).toEqual(a.slice(0, 4))
  })
})

describe('likelyDuplicates', () => {
  it('kjenner igjen kjøp som er ført for hånd, én gang hver', () => {
    const rows = parseBankCsv(DNB_OLD).rows
    const existing = [
      { id: 'a', amount_ore: 24990, occurred_on: '2026-10-17' },
      { id: 'b', amount_ore: 8900, occurred_on: '2026-10-01' },
    ]
    // Bare én av de to REMA-radene matcher, og Narvesen er for langt unna i tid
    expect([...likelyDuplicates(rows, existing)]).toEqual([0])
  })
})

describe('likelyTransfers', () => {
  const row = (date: string, direction: 'in' | 'out', kr: number, description: string) => ({ line: 0, date, direction, amountOre: kr * 100, description })
  it('kjenner igjen nedbetaling av kredittkortet fra brukskontoen', () => {
    const rows = [
      row('2026-10-21', 'out', 17631.42, 'Til : 1234.56.78901'),
      row('2026-10-21', 'in', 17631.42, 'Innbetaling'),
      row('2026-10-21', 'out', 99, 'Rema 1000'),
    ]
    expect([...likelyTransfers(rows)]).toEqual([[0, 'transfer'], [1, 'mirror']])
  })
  it('en ensom innbetaling til kortet regnes også som overføring', () => {
    expect([...likelyTransfers([row('2026-10-14', 'in', 4000, 'Innbetaling')])]).toEqual([[0, 'transfer']])
    expect([...likelyTransfers([row('2026-10-14', 'out', 4000, 'Til : 1234.56.78901')])]).toEqual([[0, 'transfer']])
  })
  it('lønn og vanlige kjøp med samme beløp pares ikke', () => {
    const rows = [row('2026-10-20', 'in', 500, 'Aspia Norge As'), row('2026-10-20', 'out', 500, 'XXL')]
    expect(likelyTransfers(rows).size).toBe(0)
  })
  it('venn som sender og får tilbake flere dager senere pares ikke', () => {
    const rows = [row('2026-10-17', 'in', 5000, 'Kari Nordmann'), row('2026-10-20', 'out', 5000, 'Vipps*Kari Nordmann')]
    expect(likelyTransfers(rows).size).toBe(0)
  })
  it('gir overføringen et navn i stedet for bare kolon', () => {
    expect(cleanMerchant('Til : 1234.56.78901')).toBe('Overføring ut')
    expect(cleanMerchant('Fra: 1234.56.78901')).toBe('Overføring inn')
  })
})
