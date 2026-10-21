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
  created_at: string
  transaction_splits: Split[]
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
      check(await supabase.from('financial_accounts').select('id, name, type, is_archived')
        .eq('household_id', householdId!).order('created_at')) as Account[],
  })
}

const TX_COLUMNS =
  'id, kind, amount_ore, occurred_on, merchant_id, category_id, account_id, to_account_id, description, note, tags, refund_of_id, created_at, transaction_splits(id, category_id, amount_ore)'

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
      mutationFn: async ({ id, ...patch }: { id: string; name?: string; is_archived?: boolean }) =>
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
