import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, type Db } from './harness'

const ISAK = '11111111-1111-1111-1111-111111111111'
const ANNEN = '22222222-2222-2222-2222-222222222222'
let db: Db

beforeAll(async () => {
  db = await createDb()
  await createUser(db, ISAK, 'isak@example.com')
  await createUser(db, ANNEN, 'annen@example.com')
}, 60_000)

const ignored = (uid: string) => asUser(db, uid, async (q) =>
  (await q<{ v: string[] }>('select ignored_subscriptions as v from user_preferences where user_id = $1', [uid])).rows[0]?.v)

describe('avviste abonnementer', () => {
  it('starter tomt og kan lagres av brukeren selv', async () => {
    expect(await ignored(ISAK)).toEqual([])
    await asUser(db, ISAK, (q) => q(`update user_preferences set ignored_subscriptions = '{k:netflix,n:gymmet}' where user_id = $1`, [ISAK]))
    expect(await ignored(ISAK)).toEqual(['k:netflix', 'n:gymmet'])
  })

  it('andre brukere verken ser eller endrer listen', async () => {
    const seen = await asUser(db, ANNEN, async (q) =>
      (await q('select 1 from user_preferences where user_id = $1', [ISAK])).rows.length)
    expect(seen).toBe(0)
    await asUser(db, ANNEN, (q) => q(`update user_preferences set ignored_subscriptions = '{}' where user_id = $1`, [ISAK]))
    expect(await ignored(ISAK)).toEqual(['k:netflix', 'n:gymmet'])
  })
})
