import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, type Db } from './harness'

const ISAK = '11111111-1111-1111-1111-111111111111'
const ANNEN = '22222222-2222-2222-2222-222222222222'

let db: Db
let hid: string
let annenHid: string
let husleieCat: string

async function householdOf(userId: string) {
  return asUser(db, userId, async (q) => {
    const r = await q<{ household_id: string }>('select household_id from household_members where user_id = $1', [userId])
    return r.rows[0].household_id
  })
}

beforeAll(async () => {
  db = await createDb()
  await createUser(db, ISAK, 'isak@example.com')
  await createUser(db, ANNEN, 'annen@example.com')
  hid = await householdOf(ISAK)
  annenHid = await householdOf(ANNEN)
  husleieCat = await asUser(db, ISAK, async (q) =>
    (await q<{ id: string }>(`select id from categories where name = 'Husleie og boliglån'`)).rows[0].id)
}, 60_000)

async function addRecurring(fields: { merchant: string; amount: number; day: number; start: string; end?: string; kind?: string }) {
  return asUser(db, ISAK, async (q) => {
    const r = await q<{ id: string }>(
      `insert into recurring (household_id, kind, amount_ore, merchant, category_id, day_of_month, start_on, end_on)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [hid, fields.kind ?? 'expense', fields.amount, fields.merchant, husleieCat, fields.day, fields.start, fields.end ?? null])
    return r.rows[0].id
  })
}

const generate = (today: string) =>
  asUser(db, ISAK, async (q) => (await q<{ n: number }>('select generate_recurring($1, $2) as n', [hid, today])).rows[0].n)

const datesOf = (rid: string) =>
  asUser(db, ISAK, async (q) =>
    (await q<{ d: string }>(`select occurred_on::text as d from transactions where recurring_id = $1 order by 1`, [rid])).rows.map((r) => r.d))

describe('faste poster', () => {
  it('registrerer alle måneder som har forfalt, og ingenting fram i tid', async () => {
    const rid = await addRecurring({ merchant: 'Husleie', amount: 1200000, day: 1, start: '2026-08-01' })
    expect(await generate('2026-10-21')).toBe(3)
    expect(await datesOf(rid)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01'])
  })

  it('lager aldri dobbelt, selv om den kjøres mange ganger', async () => {
    expect(await generate('2026-10-21')).toBe(0)
    expect(await generate('2026-10-21')).toBe(0)
  })

  it('31. blir siste dag i korte måneder', async () => {
    const rid = await addRecurring({ merchant: 'Lønn', amount: 3500000, day: 31, start: '2026-01-15', kind: 'income' })
    await generate('2026-04-30')
    expect(await datesOf(rid)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('slettet registrering lages ikke på nytt', async () => {
    const rid = await addRecurring({ merchant: 'Strømming', amount: 14900, day: 5, start: '2026-10-01' })
    await generate('2026-10-21')
    await asUser(db, ISAK, (q) => q(`delete from transactions where recurring_id = $1`, [rid]))
    expect(await generate('2026-10-21')).toBe(0)
    expect(await datesOf(rid)).toEqual([])
  })

  it('bytte av dag midt i måneden gir ikke to registreringer samme måned', async () => {
    const rid = await addRecurring({ merchant: 'Trening', amount: 49900, day: 1, start: '2026-10-01' })
    await generate('2026-10-21')
    await asUser(db, ISAK, (q) => q(`update recurring set day_of_month = 15 where id = $1`, [rid]))
    await generate('2026-10-21')
    expect(await datesOf(rid)).toEqual(['2026-10-01'])
    await generate('2026-11-20')
    expect(await datesOf(rid)).toEqual(['2026-10-01', '2026-11-15'])
  })

  it('stopper på sluttdato og når den er satt på pause', async () => {
    const ended = await addRecurring({ merchant: 'Kurs', amount: 100000, day: 10, start: '2026-08-01', end: '2026-09-30' })
    const paused = await addRecurring({ merchant: 'Avis', amount: 29900, day: 10, start: '2026-08-01' })
    await asUser(db, ISAK, (q) => q(`update recurring set is_active = false where id = $1`, [paused]))
    await generate('2026-10-21')
    expect(await datesOf(ended)).toEqual(['2026-08-10', '2026-09-10'])
    expect(await datesOf(paused)).toEqual([])
  })

  it('husker butikken og kategorien', async () => {
    await asUser(db, ISAK, async (q) => {
      const r = await q<{ default_category_id: string }>(`select default_category_id from merchants where normalized_name = 'husleie'`)
      expect(r.rows[0].default_category_id).toBe(husleieCat)
    })
  })

  it('en annen bruker ser ikke og kan ikke kjøre dine faste poster', async () => {
    await asUser(db, ANNEN, async (q) => {
      const r = await q<{ n: number }>(`select count(*)::int as n from recurring`)
      expect(r.rows[0].n).toBe(0)
      const g = await q<{ n: number }>('select generate_recurring($1, $2) as n', [hid, '2027-12-31'])
      expect(g.rows[0].n).toBe(0)
    })
    await expect(asUser(db, ANNEN, (q) =>
      q(`insert into recurring (household_id, kind, amount_ore, merchant, day_of_month, start_on) values ($1, 'expense', 100, 'x', 1, '2026-01-01')`, [hid])))
      .rejects.toThrow(/row-level security/)
  })

  it('overføring kan ikke være en fast post', async () => {
    await expect(addRecurring({ merchant: 'Sparing', amount: 100, day: 1, start: '2026-10-01', kind: 'transfer' })).rejects.toThrow(/check/)
  })
})

describe('budsjett', () => {
  it('ett budsjett per kategori, bare for egen husholdning', async () => {
    await asUser(db, ISAK, (q) => q(`insert into budgets (household_id, category_id, amount_ore) values ($1, $2, 1500000)`, [hid, husleieCat]))
    await expect(asUser(db, ISAK, (q) =>
      q(`insert into budgets (household_id, category_id, amount_ore) values ($1, $2, 100)`, [hid, husleieCat]))).rejects.toThrow(/duplicate/)
    await expect(asUser(db, ANNEN, (q) =>
      q(`insert into budgets (household_id, category_id, amount_ore) values ($1, $2, 100)`, [annenHid, husleieCat]))).rejects.toThrow(/foreign key/)
    await asUser(db, ANNEN, async (q) => {
      expect((await q(`select * from budgets`)).rows.length).toBe(0)
    })
  })
})

describe('import', () => {
  const rows = [
    { key: 'dnb:a', date: '2026-10-02', amount_ore: 24900, kind: 'expense', merchant: 'REMA 1000', category_id: null, note: 'Varekjøp REMA 1000 OSLO' },
    { key: 'dnb:b', date: '2026-10-03', amount_ore: 3500000, kind: 'income', merchant: 'Aspia', category_id: null, note: null },
  ]
  const run = (r: unknown[], user = ISAK, h = hid) =>
    asUser(db, user, async (q) => (await q<{ n: number }>('select import_transactions($1, null, $2) as n', [h, JSON.stringify(r)])).rows[0].n)

  it('importerer, og samme fil to ganger gir ingen duplikater', async () => {
    expect(await run(rows)).toBe(2)
    expect(await run(rows)).toBe(0)
    await asUser(db, ISAK, async (q) => {
      const r = await q<{ n: number }>(`select count(*)::int as n from transactions where import_key like 'dnb:%'`)
      expect(r.rows[0].n).toBe(2)
    })
  })

  it('avviser ugyldige typer og andres husholdning', async () => {
    await expect(run([{ ...rows[0], key: 'dnb:c', kind: 'transfer' }])).rejects.toThrow(/Ugyldig type/)
    await expect(run([{ ...rows[0], key: 'dnb:d' }], ANNEN, hid)).rejects.toThrow(/row-level security/)
  })
})
