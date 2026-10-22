import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, type Db } from './harness'
import { likelyDuplicates } from '../../src/lib/bankImport'

const ISAK = '11111111-1111-1111-1111-111111111111'
const ANNEN = '22222222-2222-2222-2222-222222222222'

let db: Db
let hid: string
let token: string
let matCat: string

beforeAll(async () => {
  db = await createDb()
  await createUser(db, ISAK, 'isak@example.com')
  await createUser(db, ANNEN, 'annen@example.com')
  hid = await asUser(db, ISAK, async (q) =>
    (await q<{ household_id: string }>('select household_id from household_members where user_id = $1', [ISAK])).rows[0].household_id)
  matCat = await asUser(db, ISAK, async (q) =>
    (await q<{ id: string }>(`select id from categories where kind = 'expense' and parent_id is null order by sort_order limit 1`)).rows[0].id)
  token = await asUser(db, ISAK, async (q) =>
    (await q<{ t: string }>('select create_ingest_token($1) as t', [hid])).rows[0].t)
}, 60_000)

const ingest = (tok: string, amount: string, merchant: string | null, card: string | null = 'DNB Mastercard') =>
  asUser(db, null, async (q) =>
    (await q<{ r: { id: string; duplicate?: boolean; category: string | null } }>('select applepay_ingest($1, $2, $3, $4) as r', [tok, amount, merchant, card])).rows[0].r)

const tx = (id: string) =>
  asUser(db, ISAK, async (q) => (await q<{ kind: string; amount_ore: string; category_id: string | null; created_by: string; source: string; note: string; merchant: string | null }>(
    `select t.kind, t.amount_ore::text, t.category_id, t.created_by, t.source, t.note, m.name as merchant
       from transactions t left join merchants m on m.id = t.merchant_id where t.id = $1`, [id])).rows[0])

describe('beløp fra Snarveier', () => {
  const cases: [string, number | null][] = [
    ['kr 129,00', 12900], ['129,00 kr', 12900], ['kr 1 234,50', 123450], ['1 234,5 kr', 123450],
    ['NOK 99', 9900], ['12.5', 1250], ['1.234', 123400], ['1,234.56', 123456], ['-kr 50,00', -5000],
    ['−49,90 kr', -4990], ['kr', null], ['', null], ['abc', null],
  ]
  it.each(cases)('%s', async (text, want) => {
    const got = await asUser(db, ISAK, async (q) => (await q<{ v: string | null }>('select parse_amount_ore($1)::text as v', [text])).rows[0].v)
    expect(got === null ? null : Number(got)).toBe(want)
  })
})

describe('Apple Pay-kjøp', () => {
  it('fører kjøpet på riktig bruker uten innlogging', async () => {
    const r = await ingest(token, 'kr 249,90', 'KIWI 123 LILLESTRØM')
    const t = await tx(r.id)
    expect(t).toMatchObject({ kind: 'expense', amount_ore: '24990', created_by: ISAK, source: 'applepay', note: 'Apple Pay DNB Mastercard' })
  })

  it('kobler butikknavn til en butikk du har fra før og bruker kategorien den husker', async () => {
    await asUser(db, ISAK, (q) => q(`select quick_add($1, 'expense', 10000, 'Rema 1000', $2, '2026-10-01')`, [hid, matCat]))
    const r = await ingest(token, '129,00 kr', 'REMA 1000 LILLESTRØM')
    const t = await tx(r.id)
    expect(t.merchant).toBe('Rema 1000')
    expect(t.category_id).toBe(matCat)
    expect(r.category).not.toBeNull()
  })

  it('samme kjøp sendt to ganger føres bare én gang', async () => {
    const a = await ingest(token, 'kr 55,00', 'Narvesen')
    const b = await ingest(token, 'kr 55,00', 'Narvesen')
    expect(b.duplicate).toBe(true)
    expect(b.id).toBe(a.id)
  })

  it('penger tilbake blir refusjon', async () => {
    const r = await ingest(token, '-kr 199,00', 'Elkjøp')
    expect((await tx(r.id)).kind).toBe('refund')
  })

  it('avviser feil nøkkel og ugyldig beløp', async () => {
    await expect(ingest('bt_feil', 'kr 10', 'X')).rejects.toThrow(/Ugyldig nøkkel/)
    await expect(ingest(token, 'gratis', 'X')).rejects.toThrow(/beløp/)
  })

  it('anonyme kan ikke lese nøkler eller transaksjoner, og andre ser ikke kjøpene', async () => {
    await expect(asUser(db, null, (q) => q('select * from ingest_tokens'))).rejects.toThrow()
    await expect(asUser(db, null, (q) => q('select * from transactions'))).rejects.toThrow()
    await expect(asUser(db, null, (q) => q('select create_ingest_token($1)', [hid]))).rejects.toThrow()
    const n = await asUser(db, ANNEN, async (q) => (await q(`select 1 from transactions where source = 'applepay'`)).rows.length)
    expect(n).toBe(0)
  })

  it('nøkkelen lagres ikke i klartekst og kan ikke lages for andres husholdning', async () => {
    await expect(asUser(db, ISAK, (q) => q('select token_hash from ingest_tokens'))).rejects.toThrow()
    const n = await asUser(db, ISAK, async (q) => (await q('select id, label, last_used_at from ingest_tokens')).rows.length)
    expect(n).toBe(1)
    await expect(asUser(db, ANNEN, (q) => q('select create_ingest_token($1)', [hid]))).rejects.toThrow(/Ingen tilgang/)
  })

  it('slettet nøkkel virker ikke lenger', async () => {
    const t2 = await asUser(db, ISAK, async (q) => (await q<{ t: string }>('select create_ingest_token($1) as t', [hid])).rows[0].t)
    await ingest(t2, 'kr 1', 'Test')
    await asUser(db, ISAK, (q) => q(`delete from ingest_tokens where last_used_at is not null and created_at = (select max(created_at) from ingest_tokens)`))
    await expect(ingest(t2, 'kr 2', 'Test')).rejects.toThrow(/Ugyldig nøkkel/)
  })

  it('DNB-importen kjenner igjen Apple Pay-kjøpet som trolig duplikat', () => {
    const dup = likelyDuplicates(
      [{ date: '2026-10-23', direction: 'out', amountOre: 24990, description: 'KIWI 123 LILLESTROM' } as never],
      [{ id: 'a', amount_ore: 24990, occurred_on: '2026-10-22', import_key: null }],
    )
    expect(dup.has(0)).toBe(true)
  })
})
