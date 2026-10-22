import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Period } from './dates'
import type { TxKind } from './finance'

export interface Category {
  id: string
  household_id: string
  parent_id: string | null
  kind: 'expense' | 'income'
  name: string
  color: string | null
  sort_order: number
  is_archived: boolean
}

export interface Merchant {
  id: string
  name: string
  normalized_name: string
  default_category_id: string | null
  use_count: number
}

export interface Account {
  id: string
  name: string
  type: string
  is_archived: boolean
  /** Saldo på startdatoen, i øre. Negativ for gjeld (kredittkort, lån). */
  opening_balance_ore: number | null
  opening_balance_on: string | null
}

export interface Split {
  id?: string
  category_id: string | null
  amount_ore: number
}

export interface Transaction {
  id: string
  kind: TxKind
  amount_ore: number
  occurred_on: string
  merchant_id: string | null
  category_id: string | null
  account_id: string | null
  to_account_id: string | null
  description: string | null
  note: string | null
  tags: string[]
  refund_of_id: string | null
  recurring_id: string | null
  created_at: string
  transaction_splits: Split[]
}

export interface Budget {
  id: string
  category_id: string
  amount_ore: number
}

export interface Recurring {
  id: string
  kind: TxKind
  amount_ore: number
  merchant: string
  category_id: string | null
  account_id: string | null
  day_of_month: number
  start_on: string
  end_on: string | null
  last_generated_on: string | null
  is_active: boolean
  note: string | null
}

function check<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error
  return res.data
}

export function useBootstrap() {
  return useQuery({
    queryKey: ['bootstrap'],
    queryFn: async () => {
      const prefs = check(await supabase.from('user_preferences').select('default_household_id, default_account_id, theme').single())
      if (!prefs?.default_household_id) throw new Error('Fant ingen husholdning for brukeren.')
      return {
        householdId: prefs.default_household_id as string,
        defaultAccountId: prefs.default_account_id as string | null,
        theme: prefs.theme as 'system' | 'light' | 'dark',
      }
    },
    staleTime: Infinity,
  })
}

export function useCategories(householdId: string | undefined) {
  return useQuery({
    queryKey: ['categories', householdId],
    enabled: !!householdId,
    queryFn: async () =>
      check(await supabase.from('categories').select('*').eq('household_id', householdId!)
        .order('sort_order').order('name')) as Category[],
  })
}

export function useMerchants(householdId: string | undefined) {
  return useQuery({
    queryKey: ['merchants', householdId],
    enabled: !!householdId,
    queryFn: async () =>
      check(await supabase.from('merchants').select('id, name, normalized_name, default_category_id, use_count')
        .eq('household_id', householdId!).order('use_count', { ascending: false })) as Merchant[],
  })
}

export function useAccounts(householdId: string | undefined) {
  return useQuery({
    queryKey: ['accounts', householdId],
    enabled: !!householdId,
    queryFn: async () =>
      check(await supabase.from('financial_accounts').select('id, name, type, is_archived, opening_balance_ore, opening_balance_on')
        .eq('household_id', householdId!).order('created_at')) as Account[],
  })
}

const TX_COLUMNS =
  'id, kind, amount_ore, occurred_on, merchant_id, category_id, account_id, to_account_id, description, note, tags, refund_of_id, recurring_id, created_at, transaction_splits(id, category_id, amount_ore)'

/** Henter alle transaksjoner i perioden, side for side, så ingenting faller bort ved mange rader. */
export function useTransactions(householdId: string | undefined, period: Period) {
  return useQuery({
    queryKey: ['tx', householdId, period.from, period.to],
    enabled: !!householdId,
    queryFn: async () => {
      const page = 1000
      const all: Transaction[] = []
      for (let offset = 0; ; offset += page) {
        const rows = check(await supabase.from('transactions').select(TX_COLUMNS)
          .eq('household_id', householdId!)
          .gte('occurred_on', period.from).lte('occurred_on', period.to)
          .order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).order('id')
          .range(offset, offset + page - 1)) as unknown as Transaction[]
        all.push(...rows)
        if (rows.length < page) break
      }
      return all
    },
  })
}

function useInvalidateMoney() {
  const qc = useQueryClient()
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ['tx'] }),
    qc.invalidateQueries({ queryKey: ['merchants'] }),
  ])
}

export interface QuickAddInput {
  householdId: string
  kind: TxKind
  amountOre: number
  merchant: string
  categoryId: string | null
  occurredOn: string
  accountId: string | null
}

export function useQuickAdd() {
  const invalidate = useInvalidateMoney()
  return useMutation({
    mutationFn: async (i: QuickAddInput) =>
      check(await supabase.rpc('quick_add', {
        p_household_id: i.householdId, p_kind: i.kind, p_amount_ore: i.amountOre,
        p_merchant: i.merchant, p_category_id: i.categoryId, p_occurred_on: i.occurredOn,
        p_account_id: i.accountId,
      })),
    onSuccess: invalidate,
  })
}

export interface SaveTxInput {
  id: string | null
  householdId: string
  kind: TxKind
  amountOre: number
  occurredOn: string
  merchant: string
  categoryId: string | null
  accountId: string | null
  toAccountId: string | null
  note: string
  tags: string[]
  refundOfId: string | null
  splits: Split[]
}

export function useSaveTransaction() {
  const invalidate = useInvalidateMoney()
  return useMutation({
    mutationFn: async (i: SaveTxInput) =>
      check(await supabase.rpc('save_transaction', {
        p_id: i.id, p_household_id: i.householdId, p_kind: i.kind, p_amount_ore: i.amountOre,
        p_occurred_on: i.occurredOn, p_merchant: i.merchant, p_category_id: i.categoryId,
        p_account_id: i.accountId, p_to_account_id: i.kind === 'transfer' ? i.toAccountId : null,
        p_note: i.note, p_tags: i.tags, p_refund_of_id: i.kind === 'refund' ? i.refundOfId : null,
        p_splits: i.splits.map((s) => ({ category_id: s.category_id, amount_ore: s.amount_ore })),
      })) as string,
    onSuccess: invalidate,
  })
}

export function useDeleteTransaction() {
  const invalidate = useInvalidateMoney()
  return useMutation({
    mutationFn: async (id: string) => {
      check(await supabase.from('transactions').delete().eq('id', id))
    },
    onSuccess: invalidate,
  })
}

export function useCategoryMutations(householdId: string | undefined) {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: ['categories'] })
  return {
    create: useMutation({
      mutationFn: async (c: { name: string; parent_id: string | null; kind: 'expense' | 'income'; color: string | null; sort_order: number }) =>
        check(await supabase.from('categories').insert({ ...c, household_id: householdId })),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...patch }: { id: string } & Partial<Pick<Category, 'name' | 'color' | 'is_archived' | 'sort_order' | 'parent_id'>>) =>
        check(await supabase.from('categories').update(patch).eq('id', id)),
      onSuccess: done,
    }),
  }
}

export function useAccountMutations(householdId: string | undefined) {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: ['accounts'] })
  return {
    create: useMutation({
      mutationFn: async (a: { name: string; type: string }) =>
        check(await supabase.from('financial_accounts').insert({ ...a, household_id: householdId })),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...patch }: { id: string; name?: string; is_archived?: boolean; opening_balance_ore?: number | null; opening_balance_on?: string | null }) =>
        check(await supabase.from('financial_accounts').update(patch).eq('id', id)),
      onSuccess: done,
    }),
  }
}

export function useSetDefaultAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, accountId }: { userId: string; accountId: string }) =>
      check(await supabase.from('user_preferences').update({ default_account_id: accountId }).eq('user_id', userId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bootstrap'] }),
  })
}

export function useSetTheme() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, theme }: { userId: string; theme: 'system' | 'light' | 'dark' }) =>
      check(await supabase.from('user_preferences').update({ theme }).eq('user_id', userId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bootstrap'] }),
  })
}

// ============================================================
// Budsjett
// ============================================================

export function useBudgets(householdId: string | undefined) {
  return useQuery({
    queryKey: ['budgets', householdId],
    enabled: !!householdId,
    queryFn: async () =>
      check(await supabase.from('budgets').select('id, category_id, amount_ore').eq('household_id', householdId!)) as Budget[],
  })
}

export function useBudgetMutations(householdId: string | undefined) {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: ['budgets'] })
  return {
    set: useMutation({
      mutationFn: async ({ categoryId, amountOre }: { categoryId: string; amountOre: number | null }) => {
        if (amountOre === null) {
          check(await supabase.from('budgets').delete().eq('household_id', householdId!).eq('category_id', categoryId))
        } else {
          check(await supabase.from('budgets').upsert(
            { household_id: householdId, category_id: categoryId, amount_ore: amountOre, updated_at: new Date().toISOString() },
            { onConflict: 'household_id,category_id' }))
        }
      },
      onSuccess: done,
    }),
  }
}

// ============================================================
// Faste poster
// ============================================================

const RECURRING_COLUMNS = 'id, kind, amount_ore, merchant, category_id, account_id, day_of_month, start_on, end_on, last_generated_on, is_active, note'

export function useRecurring(householdId: string | undefined) {
  return useQuery({
    queryKey: ['recurring', householdId],
    enabled: !!householdId,
    queryFn: async () =>
      check(await supabase.from('recurring').select(RECURRING_COLUMNS).eq('household_id', householdId!)
        .order('day_of_month').order('merchant')) as Recurring[],
  })
}

export type RecurringInput = Omit<Recurring, 'id' | 'last_generated_on'>

/** Registrerer faste poster som har forfalt. Kjøres når appen åpnes og når den kommer tilbake i forgrunnen. */
export async function generateRecurring(householdId: string): Promise<number> {
  return check(await supabase.rpc('generate_recurring', { p_household_id: householdId })) as number
}

export function useRecurringMutations(householdId: string | undefined) {
  const qc = useQueryClient()
  // Nye eller endrede faste poster kan gi transaksjoner med en gang
  const done = async () => {
    if (householdId) await generateRecurring(householdId).catch(() => 0)
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['recurring'] }),
      qc.invalidateQueries({ queryKey: ['tx'] }),
      qc.invalidateQueries({ queryKey: ['merchants'] }),
    ])
  }
  return {
    create: useMutation({
      mutationFn: async (r: RecurringInput) =>
        check(await supabase.from('recurring').insert({ ...r, household_id: householdId })),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...patch }: { id: string } & Partial<RecurringInput>) =>
        check(await supabase.from('recurring').update(patch).eq('id', id)),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => { check(await supabase.from('recurring').delete().eq('id', id)) },
      onSuccess: done,
    }),
  }
}

// ============================================================
// Import fra banken
// ============================================================

export interface ImportRow {
  key: string
  date: string
  amount_ore: number
  kind: 'expense' | 'income' | 'refund' | 'saving' | 'transfer'
  /** Bare for overføringer: om pengene gikk ut av eller inn på kontoen som importeres */
  direction?: 'in' | 'out'
  /** Bare for overføringer: den andre kontoen, eller null hvis den ikke er lagt inn i appen */
  other_account_id?: string | null
  merchant: string
  category_id: string | null
  note: string
}

/** Transaksjoner i perioden, brukt til å kjenne igjen det som er importert eller ført for hånd før. */
export async function fetchExistingForImport(householdId: string, from: string, to: string) {
  const all: { id: string; kind: string; amount_ore: number; occurred_on: string; import_key: string | null }[] = []
  for (let offset = 0; ; offset += 1000) {
    const rows = check(await supabase.from('transactions').select('id, kind, amount_ore, occurred_on, import_key')
      .eq('household_id', householdId).gte('occurred_on', from).lte('occurred_on', to)
      .order('occurred_on').order('id').range(offset, offset + 999)) as typeof all
    all.push(...rows)
    if (rows.length < 1000) break
  }
  return all
}

export function useImportTransactions() {
  const invalidate = useInvalidateMoney()
  return useMutation({
    mutationFn: async ({ householdId, accountId, rows }: { householdId: string; accountId: string | null; rows: ImportRow[] }) =>
      check(await supabase.rpc('import_transactions', { p_household_id: householdId, p_account_id: accountId, p_rows: rows })) as number,
    onSuccess: invalidate,
  })
}

// ============================================================
// Apple Pay: nøkler som lar Snarveier på iPhone føre kjøp
// ============================================================

export interface IngestToken {
  id: string
  label: string
  created_at: string
  last_used_at: string | null
}

export function useIngestTokens(userId: string | undefined) {
  return useQuery({
    queryKey: ['ingest_tokens', userId],
    enabled: !!userId,
    // token_hash er ikke lesbar fra appen, så kolonnene må listes eksplisitt
    queryFn: async () =>
      check(await supabase.from('ingest_tokens').select('id, label, created_at, last_used_at')
        .eq('user_id', userId!).order('created_at')) as IngestToken[],
  })
}

export function useIngestTokenMutations() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: ['ingest_tokens'] })
  return {
    create: useMutation({
      mutationFn: async ({ householdId, label }: { householdId: string; label: string }) =>
        check(await supabase.rpc('create_ingest_token', { p_household_id: householdId, p_label: label })) as string,
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => { check(await supabase.from('ingest_tokens').delete().eq('id', id)) },
      onSuccess: done,
    }),
  }
}

/** Kategoriforslag fra kjedelista i databasen, for butikker uten lært kategori. */
export async function suggestFromRules(householdId: string, names: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (names.length === 0) return map
  const rows = check(await supabase.rpc('suggest_categories', { p_household_id: householdId, p_names: names })) as { name: string; category_id: string | null }[]
  for (const r of rows) if (r.category_id) map.set(r.name, r.category_id)
  return map
}

// ============================================================
// Abonnementsjeger
// ============================================================

/** Tjenester du har sagt ikke er abonnement. Gir tom liste i stedet for feil, så resten av appen aldri stopper av dette. */
export function useIgnoredSubscriptions(userId: string | undefined) {
  return useQuery({
    queryKey: ['ignored_subscriptions', userId],
    enabled: !!userId,
    queryFn: async () => {
      const res = await supabase.from('user_preferences').select('ignored_subscriptions').eq('user_id', userId!).maybeSingle()
      if (res.error) return [] as string[]
      return ((res.data as { ignored_subscriptions?: string[] } | null)?.ignored_subscriptions ?? []) as string[]
    },
  })
}

export function useSetIgnoredSubscriptions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, keys }: { userId: string; keys: string[] }) =>
      check(await supabase.from('user_preferences').update({ ignored_subscriptions: keys }).eq('user_id', userId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ignored_subscriptions'] }),
  })
}
