import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, type Db } from './harness'

const ISAK = '11111111-1111-1111-1111-111111111111'

let db: Db
let hid: string

beforeAll(async () => {
  db = await createDb()
  await createUser(db, ISAK, 'isak@example.com')
  hid = await asUser(db, ISAK, async (q) =>
    (await q<{ household_id: string }>('select household_id from household_members where user_id = $1', [ISAK])).rows[0].household_id)
}, 60_000)

const guess = (name: string) =>
  asUser(db, ISAK, async (q) => (await q<{ cat: string | null }>(
    `select coalesce(p.name || ' / ', '') || c.name as cat
       from categories c left join categories p on p.id = c.parent_id
      where c.id = rule_category($1, $2)`, [hid, name])).rows[0]?.cat ?? null)

describe('kjedeliste', () => {
  const cases: [string, string | null][] = [
    ['REMA 1000 LILLESTRØM', 'Mat og dagligvarer / Dagligvarer'],
    ['KIWI 123 STRØMMEN', 'Mat og dagligvarer / Dagligvarer'],
    ['Extra', 'Mat og dagligvarer / Dagligvarer'],
    ['COOP EXTRA LILLESTROM', 'Mat og dagligvarer / Dagligvarer'],
    ['Coop Bygg Lillestrøm', 'Shopping / Hjem og interiør'],
    ['Vinmonopolet Lillestrøm', 'Mat og dagligvarer / Dagligvarer'],
    ['NARVESEN OSLO S', 'Mat og dagligvarer / Kiosk og bensinstasjon'],
    ['7-Eleven Helsfyr', 'Mat og dagligvarer / Kiosk og bensinstasjon'],
    ['Circle K Kjeller', 'Transport og bil / Drivstoff og lading'],
    ['RUTER AS', 'Transport og bil / Kollektiv'],
    ['Vy', 'Transport og bil / Kollektiv'],
    ['EasyPark', 'Transport og bil / Parkering og bom'],
    ["McDonald's Lillestrøm", 'Restaurant og kafé / Takeaway'],
    ['Foodora', 'Restaurant og kafé / Takeaway'],
    ['SumUp *Kafé Hjørnet', 'Restaurant og kafé / Kafé'],
    ['Espresso House Helsfyr', 'Restaurant og kafé / Kafé'],
    ['Peppes Pizza', 'Restaurant og kafé / Restaurant'],
    ['Pizzeria Napoli', 'Restaurant og kafé / Restaurant'],
    ['ELKJØP LILLESTRØM', 'Shopping / Elektronikk'],
    ['Power Strømmen', 'Shopping / Elektronikk'],
    ['H&M Strømmen Storsenter', 'Shopping / Klær'],
    ['IKEA Furuset', 'Shopping / Hjem og interiør'],
    ['Apotek 1 Lillestrøm', 'Helse og trening / Lege og apotek'],
    ['Vitusapotek', 'Helse og trening / Lege og apotek'],
    ['SATS Lillestrøm', 'Helse og trening / Trening'],
    ['XXL Strømmen', 'Helse og trening / Trening'],
    ['NETFLIX.COM', 'Abonnementer / Strømmetjenester'],
    ['Spotify AB', 'Abonnementer / Strømmetjenester'],
    ['APPLE.COM/BILL', 'Abonnementer / Programvare'],
    ['Telenor Norge', 'Abonnementer / Mobil og internett'],
    ['Norwegian Air Shuttle', 'Reise og ferie / Fly og tog'],
    ['Scandic Oslo City', 'Reise og ferie / Overnatting'],
    ['Best Western Plus', 'Reise og ferie / Overnatting'],
    ['Ticketmaster', 'Underholdning / Konsert og arrangement'],
    ['Steam Purchase', 'Underholdning / Spill og hobby'],
    ['Interflora', 'Gaver'],
    ['Ola Nordmann Rørlegger', null],
    ['', null],
  ]
  it.each(cases)('%s', async (name, want) => {
    expect(await guess(name)).toBe(want)
  })

  it('bruker hovedkategorien hvis underkategorien er arkivert', async () => {
    await asUser(db, ISAK, (q) => q(`update categories set is_archived = true where name = 'Kafé'`))
    expect(await guess('Espresso House')).toBe('Restaurant og kafé')
    await asUser(db, ISAK, (q) => q(`update categories set is_archived = false where name = 'Kafé'`))
  })

  it('kategorien du har valgt for butikken går foran lista', async () => {
    const kiosk = await asUser(db, ISAK, async (q) =>
      (await q<{ id: string }>(`select id from categories where name = 'Kiosk og bensinstasjon'`)).rows[0].id)
    await asUser(db, ISAK, (q) => q(`select quick_add($1, 'expense', 5000, 'Circle K', $2, '2026-10-01')`, [hid, kiosk]))
    const r = await asUser(db, ISAK, async (q) =>
      (await q<{ name: string; category_id: string }>(`select * from suggest_categories($1, array['CIRCLE K KJELLER', 'Rema 1000 Torget', 'Ukjent AS'])`, [hid])).rows)
    expect(r[0].category_id).toBe(kiosk)
    expect(r[1].category_id).not.toBeNull()
    expect(r[2].category_id).toBeNull()
  })

  it('Apple Pay-kjøp i en ny butikk får kategori fra lista', async () => {
    const token = await asUser(db, ISAK, async (q) => (await q<{ t: string }>('select create_ingest_token($1) as t', [hid])).rows[0].t)
    const r = await asUser(db, null, async (q) =>
      (await q<{ r: { category: string | null } }>('select applepay_ingest($1, $2, $3, $4) as r', [token, 'kr 89,00', 'ESPRESSO HOUSE OSLO S', null])).rows[0].r)
    expect(r.category).toBe('Kafé')
  })
})
