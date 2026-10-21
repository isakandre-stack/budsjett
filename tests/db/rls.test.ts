import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, type Db } from './harness'

const ISAK = '11111111-1111-1111-1111-111111111111'
const ANNEN = '22222222-2222-2222-2222-222222222222'

let db: Db
let isakHousehold: string
let annenHousehold: string

async function householdOf(userId: string) {
  return asUser(db, userId, async (q) => {
    const r = await q<{ household_id: string }>('select household_id from household_members where user_id = $1', [userId])
    return r.rows[0].household_id
  })
}

async function categoryId(userId: string, name: string) {
  return asUser(db, userId, async (q) => {
    const r = await q<{ id: string }>('select id from categories where name = $1', [name])
    return r.rows[0].id
  })
}

beforeAll(async () => {
  db = await createDb()
  await createUser(db, ISAK, 'isak@example.com')
  await createUser(db, ANNEN, 'annen@example.com')
  isakHousehold = await householdOf(ISAK)
  annenHousehold = await householdOf(ANNEN)
}, 60_000)

describe('ny bruker', () => {
  it('får egen husholdning, konto og standardkategorier', async () => {
    await asUser(db, ISAK, async (q) => {
      const cats = await q<{ n: number }>('select count(*)::int as n from categories where parent_id is null')
      expect(cats.rows[0].n).toBe(16)
      const acc = await q<{ name: string }>('select name from financial_accounts')
      expect(acc.rows.map((r) => r.name)).toEqual(['Brukskonto'])
      const pref = await q<{ default_household_id: string }>('select default_household_id from user_preferences')
      expect(pref.rows[0].default_household_id).toBe(isakHousehold)
    })
    expect(isakHousehold).not.toBe(annenHousehold)
  })
})

describe('tilgang', () => {
  it('anonyme ser ingenting', async () => {
    await expect(asUser(db, null, (q) => q('select * from transactions'))).rejects.toThrow(/permission denied/)
  })

  it('innlogget bruker uten tofaktor (aal1) får tilgang til egne data', async () => {
    await asUser(db, ISAK, async (q) => {
      const r = await q('select * from categories')
      expect(r.rows.length).toBeGreaterThan(0)
    }, 'aal1')
    await asUser(db, ISAK, (q) =>
      q(`insert into transactions (household_id, kind, amount_ore, occurred_on) values ($1, 'expense', 100, '2026-10-01')`, [isakHousehold]),
    'aal1')
  })

  it('aal1 ser fortsatt ikke andres data', async () => {
    await asUser(db, ANNEN, async (q) => {
      const r = await q<{ n: number }>('select count(*)::int as n from transactions where household_id = $1', [isakHousehold])
      expect(r.rows[0].n).toBe(0)
    }, 'aal1')
  })

  it('en bruker ser aldri en annen brukers data', async () => {
    const mat = await categoryId(ISAK, 'Dagligvarer')
    await asUser(db, ISAK, (q) =>
      q(`select quick_add($1, 'expense', 24900, 'REMA 1000', $2, '2026-10-05')`, [isakHousehold, mat]))

    await asUser(db, ANNEN, async (q) => {
      const checks: [string, string][] = [
        ['select count(*)::int as n from transactions where household_id = $1', isakHousehold],
        ['select count(*)::int as n from merchants where household_id = $1', isakHousehold],
        ['select count(*)::int as n from categories where household_id = $1', isakHousehold],
        ['select count(*)::int as n from financial_accounts where household_id = $1', isakHousehold],
        ['select count(*)::int as n from households where id = $1', isakHousehold],
        ['select count(*)::int as n from household_members where user_id = $1', ISAK],
        ['select count(*)::int as n from profiles where id = $1', ISAK],
        ['select count(*)::int as n from user_preferences where user_id = $1', ISAK],
      ]
      for (const [sql, param] of checks) {
        const r = await q<{ n: number }>(sql, [param])
        expect(r.rows[0].n, sql).toBe(0)
      }
    })
  })

  it('kan ikke skrive inn i en annen husholdning', async () => {
    await expect(
      asUser(db, ANNEN, (q) =>
        q(`insert into transactions (household_id, kind, amount_ore, occurred_on) values ($1, 'expense', 100, '2026-10-01')`, [isakHousehold])),
    ).rejects.toThrow(/row-level security/)
  })

  it('kan ikke peke på en annen husholdnings kategori', async () => {
    const isakCat = await categoryId(ISAK, 'Dagligvarer')
    await expect(
      asUser(db, ANNEN, (q) =>
        q(`insert into transactions (household_id, kind, amount_ore, occurred_on, category_id) values ($1, 'expense', 100, '2026-10-01', $2)`,
          [annenHousehold, isakCat])),
    ).rejects.toThrow(/foreign key/)
  })

  it('kan ikke oppdatere eller slette en annen brukers transaksjon', async () => {
    const id = await asUser(db, ISAK, async (q) => {
      const r = await q<{ id: string }>(`insert into transactions (household_id, kind, amount_ore, occurred_on) values ($1, 'expense', 5000, '2026-10-02') returning id`, [isakHousehold])
      return r.rows[0].id
    })
    await asUser(db, ANNEN, async (q) => {
      const u = await q('update transactions set amount_ore = 1 where id = $1', [id])
      expect(u.affectedRows).toBe(0)
      const d = await q('delete from transactions where id = $1', [id])
      expect(d.affectedRows).toBe(0)
    })
    await asUser(db, ISAK, async (q) => {
      const r = await q<{ amount_ore: string }>('select amount_ore::text from transactions where id = $1', [id])
      expect(r.rows[0].amount_ore).toBe('5000')
    })
  })

  it('kan ikke flytte en transaksjon til en annen eier eller husholdning', async () => {
    await expect(asUser(db, ISAK, (q) =>
      q('update transactions set household_id = $1', [annenHousehold]))).rejects.toThrow()
  })

  it('kan ikke legge seg selv til i en annen husholdning', async () => {
    await expect(asUser(db, ANNEN, (q) =>
      q(`insert into household_members (household_id, user_id, role) values ($1, $2, 'owner')`, [isakHousehold, ANNEN]))).rejects.toThrow(/permission denied/)
  })

  it('kan ikke kalle seed_household direkte', async () => {
    await expect(asUser(db, ANNEN, (q) => q('select seed_household($1)', [isakHousehold]))).rejects.toThrow(/permission denied/)
  })
})

describe('hurtigregistrering og butikker', () => {
  it('gjenbruker butikk uavhengig av store bokstaver og mellomrom, og husker siste kategori', async () => {
    const mat = await categoryId(ISAK, 'Dagligvarer')
    const kiosk = await categoryId(ISAK, 'Kiosk og bensinstasjon')
    await asUser(db, ISAK, async (q) => {
      await q(`select quick_add($1, 'expense', 10000, 'Kiwi', $2, '2026-10-06')`, [isakHousehold, mat])
      await q(`select quick_add($1, 'expense', 20000, '  kiwi ', $2, '2026-10-07')`, [isakHousehold, kiosk])
      const m = await q<{ n: number; use_count: number; default_category_id: string }>(
        `select count(*) over ()::int as n, use_count, default_category_id from merchants where normalized_name = 'kiwi'`)
      expect(m.rows[0].n).toBe(1)
      expect(m.rows[0].use_count).toBe(2)
      expect(m.rows[0].default_category_id).toBe(kiosk)
    })
  })

  it('teller butikken som brukt også uten kategori, og glemmer ikke kategorien den husker', async () => {
    const mat = await categoryId(ISAK, 'Dagligvarer')
    await asUser(db, ISAK, async (q) => {
      await q(`select quick_add($1, 'expense', 10000, 'Bunnpris', null, '2026-10-06')`, [isakHousehold])
      let m = await q<{ use_count: number; default_category_id: string | null }>(`select use_count, default_category_id from merchants where normalized_name = 'bunnpris'`)
      expect(m.rows[0].use_count).toBe(1)
      await q(`select quick_add($1, 'expense', 10000, 'Bunnpris', $2, '2026-10-07')`, [isakHousehold, mat])
      await q(`select quick_add($1, 'expense', 10000, 'Bunnpris', null, '2026-10-08')`, [isakHousehold])
      m = await q(`select use_count, default_category_id from merchants where normalized_name = 'bunnpris'`)
      expect(m.rows[0].use_count).toBe(3)
      expect(m.rows[0].default_category_id).toBe(mat)
    })
  })

  it('avviser null og negative beløp', async () => {
    for (const amount of [0, -100]) {
      await expect(asUser(db, ISAK, (q) =>
        q(`select quick_add($1, 'expense', $2, 'X', null, '2026-10-06')`, [isakHousehold, amount]))).rejects.toThrow(/check constraint/)
    }
  })
})

describe('splitting', () => {
  async function newTx(amount: number) {
    return asUser(db, ISAK, async (q) => {
      const r = await q<{ id: string }>(`insert into transactions (household_id, kind, amount_ore, occurred_on) values ($1, 'expense', $2, '2026-10-10') returning id`, [isakHousehold, amount])
      return r.rows[0].id
    })
  }

  it('godtar splitt som summerer til beløpet', async () => {
    const id = await newTx(30000)
    const a = await categoryId(ISAK, 'Dagligvarer')
    const b = await categoryId(ISAK, 'Hjem og interiør')
    await asUser(db, ISAK, (q) =>
      q(`insert into transaction_splits (transaction_id, household_id, category_id, amount_ore) values ($1, $2, $3, 20000), ($1, $2, $4, 10000)`,
        [id, isakHousehold, a, b]))
  })

  it('avviser splitt som ikke summerer til beløpet', async () => {
    const id = await newTx(30000)
    await expect(asUser(db, ISAK, (q) =>
      q(`insert into transaction_splits (transaction_id, household_id, amount_ore) values ($1, $2, 20000)`, [id, isakHousehold]))).rejects.toThrow(/summerer ikke/)
  })

  it('avviser endring av beløp som gjør eksisterende splitt feil', async () => {
    const id = await newTx(10000)
    await asUser(db, ISAK, (q) =>
      q(`insert into transaction_splits (transaction_id, household_id, amount_ore) values ($1, $2, 4000), ($1, $2, 6000)`, [id, isakHousehold]))
    await expect(asUser(db, ISAK, (q) => q('update transactions set amount_ore = 12000 where id = $1', [id]))).rejects.toThrow(/summerer ikke/)
  })
})

describe('save_transaction', () => {
  const save = (q: Db['query'], args: Record<string, unknown>) =>
    q<{ id: string }>(`select save_transaction(
      p_id => $1, p_household_id => $2, p_kind => $3, p_amount_ore => $4, p_occurred_on => $5,
      p_merchant => $6, p_category_id => $7, p_splits => $8::jsonb) as id`,
      [args.id ?? null, args.household ?? isakHousehold, args.kind ?? 'expense', args.amount, '2026-10-15',
       args.merchant ?? null, args.category ?? null, JSON.stringify(args.splits ?? [])])

  it('oppretter med splitt, endrer beløp og splitt samtidig, og fjerner splitt igjen', async () => {
    const a = await categoryId(ISAK, 'Dagligvarer')
    const b = await categoryId(ISAK, 'Klær')
    await asUser(db, ISAK, async (q) => {
      const r = await save(q, { amount: 50000, merchant: 'Obs', splits: [{ category_id: a, amount_ore: 30000 }, { category_id: b, amount_ore: 20000 }] })
      const id = r.rows[0].id
      await save(q, { id, amount: 60000, merchant: 'Obs', splits: [{ category_id: a, amount_ore: 10000 }, { category_id: b, amount_ore: 50000 }] })
      let s = await q<{ n: number; sum: string }>('select count(*)::int as n, sum(amount_ore)::text as sum from transaction_splits where transaction_id = $1', [id])
      expect(s.rows[0]).toEqual({ n: 2, sum: '60000' })
      await save(q, { id, amount: 60000, merchant: 'Obs', category: a })
      s = await q('select count(*)::int as n, sum(amount_ore)::text as sum from transaction_splits where transaction_id = $1', [id])
      expect(s.rows[0].n).toBe(0)
    })
  })

  it('ruller tilbake alt hvis splittene ikke stemmer', async () => {
    await asUser(db, ISAK, async (q) => {
      const before = await q<{ n: number }>(`select count(*)::int as n from merchants where normalized_name = 'feilbutikk'`)
      expect(before.rows[0].n).toBe(0)
    })
    await expect(asUser(db, ISAK, (q) =>
      save(q, { amount: 10000, merchant: 'Feilbutikk', splits: [{ amount_ore: 1 }, { amount_ore: 2 }] }))).rejects.toThrow(/summerer ikke/)
    await asUser(db, ISAK, async (q) => {
      const after = await q<{ n: number }>(`select count(*)::int as n from merchants where normalized_name = 'feilbutikk'`)
      expect(after.rows[0].n).toBe(0)
    })
  })

  it('kan ikke endre en annen brukers transaksjon', async () => {
    const id = await asUser(db, ISAK, async (q) => (await save(q, { amount: 100 })).rows[0].id)
    await expect(asUser(db, ANNEN, (q) => save(q, { id, household: annenHousehold, amount: 1 }))).rejects.toThrow(/Fant ikke/)
    await expect(asUser(db, ANNEN, (q) => save(q, { id, household: isakHousehold, amount: 1 }))).rejects.toThrow()
  })
})

describe('regler for transaksjonstyper', () => {
  it('refusjon kan kobles til opprinnelig kjøp, men andre typer kan ikke', async () => {
    await asUser(db, ISAK, async (q) => {
      const orig = await q<{ id: string }>(`insert into transactions (household_id, kind, amount_ore, occurred_on) values ($1, 'expense', 50000, '2026-10-11') returning id`, [isakHousehold])
      await q(`insert into transactions (household_id, kind, amount_ore, occurred_on, refund_of_id) values ($1, 'refund', 50000, '2026-10-12', $2)`, [isakHousehold, orig.rows[0].id])
    })
    await expect(asUser(db, ISAK, async (q) => {
      const orig = await q<{ id: string }>(`select id from transactions limit 1`)
      await q(`insert into transactions (household_id, kind, amount_ore, occurred_on, refund_of_id) values ($1, 'expense', 100, '2026-10-12', $2)`, [isakHousehold, orig.rows[0].id])
    })).rejects.toThrow(/check constraint/)
  })

  it('underkategorier kan ikke ha egne underkategorier', async () => {
    const sub = await categoryId(ISAK, 'Dagligvarer')
    await expect(asUser(db, ISAK, (q) =>
      q(`insert into categories (household_id, parent_id, name) values ($1, $2, 'For dypt')`, [isakHousehold, sub]))).rejects.toThrow(/ett nivå/)
  })
  it('en hovedkategori med underkategorier kan ikke flyttes inn under en annen', async () => {
    const mat = await categoryId(ISAK, 'Mat og dagligvarer')
    const shopping = await categoryId(ISAK, 'Shopping')
    await expect(asUser(db, ISAK, (q) =>
      q(`update categories set parent_id = $1 where id = $2`, [shopping, mat]))).rejects.toThrow(/ett nivå/)
  })
})
