import { describe, expect, it } from 'vitest'
import { addMonths, findSubscriptions, ignoreKeyOf, knownService, subscriptionKey, totals, type ChargeLike } from '../../src/lib/subscriptions'

let n = 0
const tx = (date: string, kr: number, description: string, extra: Partial<ChargeLike> = {}): ChargeLike => ({
  id: `t${++n}`, kind: 'expense', amount_ore: Math.round(kr * 100), occurred_on: date, merchant_id: null, description, ...extra,
})
const monthly = (desc: string, kr: number, day: number, from: number, to: number, year = 2026) =>
  Array.from({ length: to - from + 1 }, (_, i) => tx(`${year}-${String(from + i).padStart(2, '0')}-${String(day).padStart(2, '0')}`, kr, desc))
const find = (txs: ChargeLike[], today = '2026-10-22', opts = {}) => findSubscriptions(txs, new Map(), today, opts)

describe('nøkler og navn', () => {
  it('samler varierende bankstekst til samme tjeneste', () => {
    expect(subscriptionKey('Spotify P2A8C1D3')).toBe(subscriptionKey('SPOTIFY P5F0B2E9'))
    expect(subscriptionKey('NETFLIX.COM')).toBe(subscriptionKey('Netflix'))
    expect(subscriptionKey('Husleie Storgata 4')).toBe(subscriptionKey('husleie storgata 12'))
  })
  it('kjenner igjen vanlige tjenester', () => {
    expect(knownService('APPLE.COM/BILL')).toBe('Apple')
    expect(knownService('TV 2 PLAY')).toBe('TV 2 Play')
    expect(knownService('REMA 1000 LILLESTRØM')).toBeNull()
  })
  it('addMonths holder seg innenfor korte måneder', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15')
  })
})

describe('finner abonnementer', () => {
  it('månedlig trekk med samme beløp', () => {
    const subs = find(monthly('NETFLIX.COM', 149, 5, 4, 10))
    expect(subs).toHaveLength(1)
    expect(subs[0]).toMatchObject({ name: 'Netflix', frequency: 'month', status: 'active', monthlyOre: 14900, yearlyOre: 178800, nextDate: '2026-11-05' })
    expect(subs[0].charges[0].date).toBe('2026-10-05')
  })

  it('tåler at datoen flytter seg noen dager og at en måned mangler', () => {
    const txs = [tx('2026-05-03', 99, 'Gymmet AS'), tx('2026-06-06', 99, 'Gymmet AS'), tx('2026-08-04', 99, 'Gymmet AS'), tx('2026-09-02', 99, 'Gymmet AS'), tx('2026-10-05', 99, 'Gymmet AS')]
    expect(find(txs)[0]).toMatchObject({ frequency: 'month', status: 'active' })
  })

  it('dagligvarer og annet som handles ofte blir ikke abonnement', () => {
    const txs = ['2026-09-01', '2026-09-03', '2026-09-08', '2026-09-15', '2026-09-20', '2026-10-01', '2026-10-04', '2026-10-12']
      .map((d, i) => tx(d, 200 + i * 37, 'REMA 1000 LILLESTRØM'))
    expect(find(txs)).toEqual([])
  })

  it('en butikk du handler i én gang i måneden med ulike beløp blir ikke abonnement', () => {
    const txs = [tx('2026-07-10', 450, 'Clas Ohlson'), tx('2026-08-11', 1290, 'Clas Ohlson'), tx('2026-09-09', 89, 'Clas Ohlson'), tx('2026-10-10', 640, 'Clas Ohlson')]
    expect(find(txs)).toEqual([])
  })

  it('to like trekk en måned fra hverandre holder, to ulike gjør det ikke for ukjente', () => {
    expect(find([tx('2026-09-14', 79, 'Ukjent App'), tx('2026-10-14', 79, 'Ukjent App')])).toHaveLength(1)
    expect(find([tx('2026-09-14', 79, 'Ukjent App'), tx('2026-10-14', 85, 'Ukjent App')])).toHaveLength(0)
  })

  it('kjent tjeneste sett én gang er et mulig abonnement, og teller ikke i totalen', () => {
    const subs = find([tx('2026-10-03', 119, 'Viaplay Group')])
    expect(subs[0]).toMatchObject({ name: 'Viaplay', status: 'possible' })
    expect(totals(subs)).toEqual({ monthlyOre: 0, yearlyOre: 0, count: 0 })
  })

  it('årlige trekk gir riktig pris per måned', () => {
    const subs = find([tx('2025-03-01', 1188, 'Adobe Systems'), tx('2026-03-02', 1188, 'Adobe Systems')])
    expect(subs[0]).toMatchObject({ frequency: 'year', monthlyOre: 9900, yearlyOre: 118800, nextDate: '2027-03-02', status: 'active' })
  })

  it('oppdager at prisen har gått opp', () => {
    const txs = [...monthly('Spotify P1', 119, 20, 5, 7), ...monthly('Spotify P2', 129, 20, 8, 10)]
    const s = find(txs)[0]
    expect(s.priceChange).toEqual({ fromOre: 11900, toOre: 12900, since: '2026-08-20' })
    expect(s.amountOre).toBe(12900)
  })

  it('regninger som varierer hver måned får ingen prisendring', () => {
    const txs = [339, 352, 347, 361, 344].map((kr, i) => tx(`2026-0${5 + i}-12`, kr, 'Fjordkraft Strøm'))
    const s = find(txs)[0]
    expect(s.frequency).toBe('month')
    expect(s.priceChange).toBeNull()
  })

  it('holder to abonnement hos samme tjeneste fra hverandre', () => {
    const txs = [...monthly('APPLE.COM/BILL', 39, 2, 6, 10), ...monthly('APPLE.COM/BILL', 129, 15, 6, 10)]
    const subs = find(txs)
    expect(subs.map((s) => s.name).sort()).toEqual(['Apple (129 kr)', 'Apple (39 kr)'])
    expect(totals(subs).monthlyOre).toBe(16800)
    expect(new Set(subs.map(ignoreKeyOf)).size).toBe(1)
  })

  it('merker det som ikke har kommet på en stund som avsluttet', () => {
    const subs = find(monthly('Storytel', 229, 8, 2, 7))
    expect(subs[0].status).toBe('ended')
    expect(totals(subs).count).toBe(0)
  })

  it('hopper over faste poster, refusjoner, framtidige datoer og det du har avvist', () => {
    const fromRecurring = monthly('Husleie', 12000, 1, 5, 10).map((t) => ({ ...t, recurring_id: 'r1' }))
    const refunds = monthly('Refusjon AS', 100, 3, 5, 10).map((t) => ({ ...t, kind: 'refund' as const }))
    const future = [tx('2026-11-01', 50, 'Fremtid'), tx('2026-12-01', 50, 'Fremtid')]
    expect(find([...fromRecurring, ...refunds, ...future])).toEqual([])
    expect(find(monthly('Netflix', 149, 5, 4, 10), '2026-10-22', { ignoredKeys: ['k:netflix'] })).toEqual([])
    expect(find(monthly('Netflix', 149, 5, 4, 10), '2026-10-22', { skipKeys: [subscriptionKey('NETFLIX')] })).toEqual([])
  })

  it('bruker butikknavnet fra registeret når det finnes', () => {
    const txs = monthly('', 59, 9, 7, 10).map((t) => ({ ...t, description: null, merchant_id: 'm1' }))
    const subs = findSubscriptions(txs, new Map([['m1', 'MITT BLAD AS']]), '2026-10-22')
    expect(subs[0].name).toBe('Mitt Blad As')
  })

  it('sorterer dyrest først og summerer bare aktive', () => {
    const subs = find([...monthly('Netflix', 149, 5, 6, 10), ...monthly('Spotify', 129, 7, 6, 10), ...monthly('Storytel', 229, 8, 2, 6)])
    expect(subs.map((s) => s.name)).toEqual(['Storytel', 'Netflix', 'Spotify'])
    expect(totals(subs)).toEqual({ monthlyOre: 27800, yearlyOre: 333600, count: 2 })
  })
})
