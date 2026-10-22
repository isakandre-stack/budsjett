// KUN FOR TESTING. Etterligner de delene av Supabase sitt API som appen bruker,
// men kjører den ekte migrasjonen og Row Level Security i Postgres (PGlite).
// Brukes til å klikke gjennom appen i en nettleser uten nettverkstilgang til Supabase.
// Kjør: node tests/e2e/fake-supabase.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createDb, createUser } from '../db/harness.ts'

const PORT = Number(process.env.PORT ?? 54321)
const db = await createDb()

const USER = { id: '11111111-1111-1111-1111-111111111111', email: 'isak@example.com', password: 'test1234' }
await createUser(db, USER.id, USER.email)
const factors: { id: string; status: 'verified' | 'unverified'; friendly_name: string }[] = []
if (process.env.MFA_DONE) factors.push({ id: randomUUID(), status: 'verified', friendly_name: 'Test' })

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
function token(aal: 'aal1' | 'aal2') {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', aal, amr: [{ method: 'password', timestamp: 0 }], exp, session_id: 's1' })}.sig`
}
function claims(req: IncomingMessage) {
  const h = req.headers.authorization ?? ''
  const t = h.replace(/^Bearer /, '')
  try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()) as { sub?: string; aal?: string; role?: string } } catch { return {} }
}
const user = () => ({
  id: USER.id, aud: 'authenticated', role: 'authenticated', email: USER.email,
  app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
  factors: factors.map((f) => ({ ...f, factor_type: 'totp', created_at: '', updated_at: '' })),
})
const session = (aal: 'aal1' | 'aal2') => ({
  access_token: token(aal), token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r-${aal}`, user: user(),
})

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const s = Buffer.concat(chunks).toString()
  return s ? JSON.parse(s) : {}
}

function send(res: ServerResponse, status: number, data?: unknown, extra: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...extra })
  res.end(data === undefined ? '' : JSON.stringify(data))
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`ugyldig navn ${s}`)
  return `"${s}"`
}

// Kjører SQL som brukeren i tokenet, med samme RLS som i Supabase.
async function asRequester<T>(req: IncomingMessage, fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>) {
  const c = claims(req)
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [c.sub ? JSON.stringify(c) : ''])
    await tx.query(c.sub ? 'set local role authenticated' : 'set local role anon')
    return fn((sql, p) => tx.query(sql, p) as Promise<{ rows: Record<string, unknown>[] }>)
  })
}

function parseSelect(sel: string, table: string) {
  // Støtter "a, b, rel(x, y)" der rel er en undertabell med fremmednøkkel til table.id
  const parts: string[] = []
  let depth = 0, cur = ''
  for (const ch of sel) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts.map((p) => {
    const m = p.match(/^(\w+)\((.*)\)$/)
    if (m) {
      const cols = m[2].split(',').map((x) => ident(x.trim())).join(', ')
      const fk = table === 'transactions' ? 'transaction_id' : `${table.replace(/s$/, '')}_id`
      return `coalesce((select json_agg(s) from (select ${cols} from public.${ident(m[1])} where ${ident(fk)} = t.id) s), '[]') as ${ident(m[1])}`
    }
    return p === '*' ? 't.*' : `t.${ident(p)}`
  }).join(', ')
}

function where(params: URLSearchParams, values: unknown[]) {
  const conds: string[] = []
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue
    const m = v.match(/^(eq|gte|lte|neq)\.(.*)$/)
    if (!m) throw new Error(`filter støttes ikke: ${k}=${v}`)
    values.push(m[2])
    const op = { eq: '=', gte: '>=', lte: '<=', neq: '<>' }[m[1]]
    conds.push(`t.${ident(k)}::text ${op} $${values.length}`)
  }
  return conds.length ? `where ${conds.join(' and ')}` : ''
}

async function rest(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname.replace('/rest/v1/', '')
  const p = url.searchParams
  const single = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  const wantReturn = String(req.headers.prefer ?? '').includes('return=representation')

  if (path.startsWith('rpc/')) {
    const fn = path.slice(4)
    const args = await body(req)
    const keys = Object.keys(args)
    const vals = keys.map((k) => (k === 'p_splits' || k === 'p_rows' ? JSON.stringify(args[k]) : args[k]))
    const call = `public.${ident(fn)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')})`
    // Funksjoner som gir flere rader blir en liste, som i PostgREST
    const setof = (await db.query<{ s: boolean }>(`select bool_or(proretset) as s from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [fn])).rows[0]?.s
    const sql = setof
      ? `select coalesce(json_agg(x), '[]') as r from ${call} x`
      : `select to_json(${call}) as r`
    const r = await asRequester(req, (q) => q(sql, vals))
    return send(res, 200, r.rows[0].r)
  }

  const table = ident(path)
  const values: unknown[] = []
  if (req.method === 'GET') {
    const order = (p.get('order') ?? '').split(',').filter(Boolean).map((o) => {
      const [c, dir] = o.split('.')
      return `t.${ident(c)} ${dir === 'desc' ? 'desc' : 'asc'}`
    })
    const sql = `select coalesce(json_agg(x), '[]') as r from (select ${parseSelect(p.get('select') ?? '*', path)} from public.${table} t ${where(p, values)}
      ${order.length ? `order by ${order.join(', ')}` : ''} ${p.get('limit') ? `limit ${Number(p.get('limit'))}` : ''} ${p.get('offset') ? `offset ${Number(p.get('offset'))}` : ''}) x`
    const r = await asRequester(req, (q) => q(sql, values))
    const rows = r.rows[0].r as unknown[]
    if (single) return rows.length === 1 ? send(res, 200, rows[0]) : send(res, 406, { message: 'JSON object requested, multiple (or no) rows returned' })
    return send(res, 200, rows)
  }
  if (req.method === 'POST') {
    const b = await body(req)
    const rows = Array.isArray(b) ? b : [b]
    await asRequester(req, async (q) => {
      // Upsert som i Supabase: on_conflict=kolonner og Prefer: resolution=merge-duplicates
      const conflict = p.get('on_conflict')
      const merge = conflict && String(req.headers.prefer ?? '').includes('merge-duplicates')
      for (const row of rows) {
        const keys = Object.keys(row)
        const upsert = merge
          ? ` on conflict (${conflict.split(',').map(ident).join(', ')}) do update set ${keys.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(', ')}`
          : ''
        await q(`insert into public.${table} (${keys.map(ident).join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})${upsert}`, keys.map((k) => row[k]))
      }
    })
    return send(res, 201, wantReturn ? rows : undefined)
  }
  if (req.method === 'PATCH') {
    const b = await body(req)
    const keys = Object.keys(b)
    keys.forEach((k) => values.push(b[k]))
    const sets = keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(', ')
    await asRequester(req, (q) => q(`update public.${table} t set ${sets} ${where(p, values)}`, values))
    return send(res, 204)
  }
  if (req.method === 'DELETE') {
    await asRequester(req, (q) => q(`delete from public.${table} t ${where(p, values)}`, values))
    return send(res, 204)
  }
  send(res, 405, { message: 'ikke støttet' })
}

async function auth(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname.replace('/auth/v1/', '')
  const c = claims(req)
  if (path === 'token') {
    const b = await body(req)
    if (url.searchParams.get('grant_type') === 'password') {
      if (b.email !== USER.email || b.password !== USER.password) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials', message: 'Invalid login credentials' })
      return send(res, 200, session('aal1'))
    }
    if (url.searchParams.get('grant_type') === 'refresh_token') return send(res, 200, session(String(b.refresh_token).endsWith('aal2') ? 'aal2' : 'aal1'))
  }
  if (path === 'user') return c.sub ? send(res, 200, user()) : send(res, 401, { message: 'no session' })
  if (path === 'logout') return send(res, 204)
  if (path === 'factors' && req.method === 'POST') {
    const b = await body(req)
    const f = { id: randomUUID(), status: 'unverified' as const, friendly_name: b.friendly_name }
    factors.push(f)
    const qr = `data:image/svg+xml;utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="#fff"/><rect x="20" y="20" width="40" height="40"/><rect x="120" y="20" width="40" height="40"/><rect x="20" y="120" width="40" height="40"/><rect x="80" y="80" width="20" height="20"/></svg>')}`
    return send(res, 200, { id: f.id, type: 'totp', factor_type: 'totp', friendly_name: f.friendly_name, totp: { qr_code: qr, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/test' } })
  }
  const m = path.match(/^factors\/([^/]+)(?:\/(challenge|verify))?$/)
  if (m) {
    const f = factors.find((x) => x.id === m[1])
    if (!f) return send(res, 404, { message: 'factor not found' })
    if (req.method === 'DELETE') { factors.splice(factors.indexOf(f), 1); return send(res, 200, { id: f.id }) }
    if (m[2] === 'challenge') return send(res, 200, { id: randomUUID(), type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 })
    if (m[2] === 'verify') {
      const b = await body(req)
      if (b.code !== '123456') return send(res, 422, { code: 422, error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered', message: 'Invalid TOTP code entered' })
      f.status = 'verified'
      return send(res, 200, session('aal2'))
    }
  }
  send(res, 404, { message: `ukjent auth-endepunkt ${path}` })
}

createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', '*')
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('access-control-expose-headers', 'content-range')
  if (req.method === 'OPTIONS') return send(res, 204)
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  try {
    if (url.pathname.startsWith('/rest/v1/')) return await rest(req, res, url)
    if (url.pathname.startsWith('/auth/v1/')) return await auth(req, res, url)
    send(res, 404, { message: 'ukjent' })
  } catch (e) {
    const err = e as { message: string; code?: string }
    console.error(req.method, url.pathname, err.message)
    send(res, 400, { message: err.message, code: err.code })
  }
}).listen(PORT, () => console.log(`fake supabase på http://localhost:${PORT}`))
