import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, type Db } from './harness'

const ISAK = '11111111-1111-1111-1111-111111111111'
let db: Db
let hid: string
let bruk: string
let kort: string

beforeAll(async () => {
  db = await createDb()
  await createUser(db, ISAK, 'isak@example.com')
  await asUser(db, ISAK, async (q) => {
    hid = (await q<{ h: string }>('select household_id as h from household_members where user_id = $1', [ISAK])).rows[0].h
    bruk = (await q<{ id: string }>(`select id from financial_accounts where household_id = $1 limit 1`, [hid])).rows[0].id
    kort = (await q<{ id: string }>(`insert into financial_accounts (household_id, name, type) values ($1, 'Kredittkort', 'credit_card') returning id`, [hid])).rows[0].id
  })
}, 60_000)

const imp = (account: string | null, rows: object[]) =>
  asUser(db, ISAK, async (q) => (await q<{ n: number }>('select import_transactions($1, $2, $3) as n', [hid, account, JSON.stringify(rows)])).rows[0].n)

describe('startsaldo og overføringer i import', () => {
  it('startsaldo lagres med dato, og begge må settes sammen', async () => {
    await asUser(db, ISAK, (q) => q(`update financial_accounts set opening_balance_ore = -300000, opening_balance_on = '2026-11-01' where id = $1`, [kort]))
    await expect(asUser(db, ISAK, (q) => q(`update financial_accounts set opening_balance_ore = 5 , opening_balance_on = null where id = $1`, [bruk])))
      .rejects.toThrow(/opening_both/)
  })

  it('overføring ut fra brukskontoen til kortet', async () => {
    expect(await imp(bruk, [{ key: 'k1', date: '2026-11-21', amount_ore: 400000, kind: 'transfer', direction: 'out', other_account_id: kort, merchant: 'Overføring ut', note: 'Til : 1234' }])).toBe(1)
    const r = await asUser(db, ISAK, async (q) => (await q<{ account_id: string; to_account_id: string; kind: string }>(`select account_id, to_account_id, kind from transactions where import_key = 'k1'`)).rows[0])
    expect(r).toEqual({ account_id: bruk, to_account_id: kort, kind: 'transfer' })
  })

  it('innbetaling på kortet fra en konto som ikke finnes i appen', async () => {
    expect(await imp(kort, [{ key: 'k2', date: '2026-11-14', amount_ore: 100000, kind: 'transfer', direction: 'in', other_account_id: null, merchant: 'Innbetaling', note: 'Innbetaling' }])).toBe(1)
    const r = await asUser(db, ISAK, async (q) => (await q<{ account_id: string | null; to_account_id: string }>(`select account_id, to_account_id from transactions where import_key = 'k2'`)).rows[0])
    expect(r).toEqual({ account_id: null, to_account_id: kort })
  })

  it('vanlige kjøp virker som før, og samme rad importeres bare én gang', async () => {
    expect(await imp(bruk, [{ key: 'k3', date: '2026-11-02', amount_ore: 9900, kind: 'expense', merchant: 'Rema 1000', category_id: null, note: '' }])).toBe(1)
    expect(await imp(bruk, [{ key: 'k3', date: '2026-11-02', amount_ore: 9900, kind: 'expense', merchant: 'Rema 1000', category_id: null, note: '' }])).toBe(0)
  })
})
