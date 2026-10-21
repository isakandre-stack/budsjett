import type { Category } from '../lib/api'

/** Kategorier gruppert under hovedkategori. Arkiverte vises bare hvis de allerede er valgt. */
export function CategorySelect({
  categories, value, onChange, kind, id, allowEmpty = true, emptyLabel = 'Ingen kategori',
}: {
  categories: Category[]
  value: string | null
  onChange: (id: string | null) => void
  kind?: 'expense' | 'income'
  id?: string
  allowEmpty?: boolean
  emptyLabel?: string
}) {
  const visible = (c: Category) => (!c.is_archived || c.id === value) && (!kind || c.kind === kind)
  const parents = categories.filter((c) => !c.parent_id && visible(c))
  return (
    <select id={id} className="field" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {parents.map((p) => {
        const subs = categories.filter((c) => c.parent_id === p.id && visible(c))
        return subs.length === 0 ? (
          <option key={p.id} value={p.id}>{p.name}</option>
        ) : (
          <optgroup key={p.id} label={p.name}>
            <option value={p.id}>{p.name} (generelt)</option>
            {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </optgroup>
        )
      })}
    </select>
  )
}

export function categoryPath(c: Category | undefined, byId: Map<string, Category>): string {
  if (!c) return 'Ukategorisert'
  const parent = c.parent_id ? byId.get(c.parent_id) : undefined
  return parent ? `${parent.name} / ${c.name}` : c.name
}

export function categoryColor(c: Category | undefined, byId: Map<string, Category>): string {
  if (!c) return 'var(--muted)'
  return c.color ?? (c.parent_id ? byId.get(c.parent_id)?.color : null) ?? 'var(--muted)'
}
