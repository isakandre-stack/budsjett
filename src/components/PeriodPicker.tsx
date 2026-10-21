import { useEffect, useRef, useState } from 'react'
import { periodOf, useApp, type PeriodSel } from '../app/AppContext'
import { monthLabel, monthOf, monthPeriod, shiftMonth, todayISO } from '../lib/dates'

function label(p: PeriodSel): string {
  if (p.mode === 'month') return monthLabel(p.month)
  if (p.mode === 'year') return `Hele ${p.year}`
  const f = (iso: string) => `${+iso.slice(8, 10)}.${+iso.slice(5, 7)}.${iso.slice(2, 4)}`
  return `${f(p.from)} til ${f(p.to)}`
}

function step(p: PeriodSel, d: number): PeriodSel | null {
  if (p.mode === 'month') return { mode: 'month', month: shiftMonth(p.month, d) }
  if (p.mode === 'year') return { mode: 'year', year: p.year + d }
  return null
}

/** align="right" når velgeren står til høyre på siden, så menyen ikke går utenfor skjermen */
export function PeriodPicker({ align = 'left' }: { align?: 'left' | 'right' }) {
  const { period, setPeriod } = useApp()
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(period.mode === 'custom' ? period.from : monthPeriod(monthOf(todayISO())).from)
  const [to, setTo] = useState(period.mode === 'custom' ? period.to : todayISO())
  const prev = step(period, -1)
  const next = step(period, 1)
  const thisMonth = monthOf(todayISO())
  const box = useRef<HTMLDivElement>(null)

  // Lukkes med Esc eller klikk utenfor
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  function toggle() {
    if (!open) {
      // Egen periode starter fra perioden du ser på nå, ikke fra det som var valgt da siden ble åpnet
      const cur = periodOf(period)
      setFrom(cur.from)
      setTo(cur.to)
    }
    setOpen(!open)
  }
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to

  const arrow = (d: 'l' | 'r') => (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d={d === 'l' ? 'M11 4L6 9l5 5' : 'M7 4l5 5-5 5'} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )

  return (
    <div className="relative" ref={box}>
      <div className="flex items-center gap-1">
        <button className="btn btn-ghost px-2" aria-label="Forrige periode" disabled={!prev} onClick={() => prev && setPeriod(prev)}>{arrow('l')}</button>
        <button className="btn btn-ghost px-2 font-semibold first-letter:uppercase min-w-36" aria-expanded={open} onClick={toggle}>
          {label(period)}
        </button>
        <button className="btn btn-ghost px-2" aria-label="Neste periode" disabled={!next} onClick={() => next && setPeriod(next)}>{arrow('r')}</button>
      </div>
      {open && (
        <div className={`absolute z-30 mt-1 ${align === 'right' ? 'right-0' : 'left-0'} w-72 max-w-[calc(100vw-2rem)] rounded-xl bg-surface shadow-xl border border-line p-3 space-y-2`}>
          <button className="btn btn-ghost w-full justify-start" onClick={() => { setPeriod({ mode: 'month', month: thisMonth }); setOpen(false) }}>Denne måneden</button>
          <button className="btn btn-ghost w-full justify-start" onClick={() => { setPeriod({ mode: 'month', month: shiftMonth(thisMonth, -1) }); setOpen(false) }}>Forrige måned</button>
          <button className="btn btn-ghost w-full justify-start" onClick={() => { setPeriod({ mode: 'year', year: thisMonth.year }); setOpen(false) }}>Hele {thisMonth.year}</button>
          <form className="border-t border-line pt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (valid) { setPeriod({ mode: 'custom', from, to }); setOpen(false) } }}>
            <p className="text-sm text-muted">Egen periode</p>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" className="field text-sm min-w-0" aria-label="Fra dato" value={from} onChange={(e) => setFrom(e.target.value)} />
              <input type="date" className="field text-sm min-w-0" aria-label="Til dato" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            {from && to && from > to && <p className="text-xs text-bad">Fra-datoen må være før til-datoen.</p>}
            <button className="btn btn-primary w-full" disabled={!valid}>Vis periode</button>
          </form>
        </div>
      )}
    </div>
  )
}
