import { useEffect, useRef, type ReactNode } from 'react'

/** Bunnark på mobil, sentrert dialog på større skjermer. Lukkes med Esc eller klikk utenfor. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  // onClose er ofte en ny funksjon ved hver rendring. Den holdes i en ref, slik at effektene under
  // bare kjører når arket åpnes og lukkes. Før flyttet hvert tastetrykk fokus ut av feltet.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  // Husker hva som hadde fokus før arket åpnet, slik at fokus kan gis tilbake når det lukkes.
  // Leses før arket tegnes, ellers ville vi fanget opp feltet som får autofokus inne i arket.
  const wasOpen = useRef(false)
  const prevFocus = useRef<HTMLElement | null>(null)
  if (open && !wasOpen.current) prevFocus.current = document.activeElement as HTMLElement | null
  wasOpen.current = open

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  // Når tastaturet åpnes på mobil, krymper det synlige området. Arket følger det synlige området,
  // og feltet du trykket på rulles til midten av arket. Før skjøv telefonen hele visningen,
  // så du havnet oppe ved beløpet i stedet for i notatfeltet.
  useEffect(() => {
    if (!open) return
    const box = root.current
    const sheet = panel.current
    if (!box || !sheet) return
    const vv = window.visualViewport

    // Ruller bare inne i arket, aldri hele siden
    const center = () => {
      const t = document.activeElement as HTMLElement | null
      if (!t || !sheet.contains(t) || !t.matches('input, textarea, select')) return
      const r = t.getBoundingClientRect()
      const s = sheet.getBoundingClientRect()
      const delta = r.top + r.height / 2 - (s.top + s.height / 2)
      if (Math.abs(delta) > 4) sheet.scrollBy({ top: delta, behavior: 'smooth' })
    }

    let timer: number | undefined
    const later = () => { window.clearTimeout(timer); timer = window.setTimeout(center, 250) }

    const fit = () => {
      if (!vv) return
      box.style.top = `${vv.offsetTop}px`
      box.style.height = `${vv.height}px`
      later()
    }
    fit()
    vv?.addEventListener('resize', fit)
    vv?.addEventListener('scroll', fit)
    sheet.addEventListener('focusin', later)
    return () => {
      vv?.removeEventListener('resize', fit)
      vv?.removeEventListener('scroll', fit)
      sheet.removeEventListener('focusin', later)
      window.clearTimeout(timer)
    }
  }, [open])

  useEffect(() => {
    if (open) return
    const prev = prevFocus.current
    if (!prev) return
    prevFocus.current = null
    // Bare hvis fokus ikke allerede er flyttet, for eksempel til et nytt ark som åpnes samtidig
    const now = document.activeElement
    if (!now || now === document.body) prev.focus?.()
  }, [open])

  if (!open) return null
  return (
    <div ref={root} className="fixed inset-x-0 top-0 h-dvh z-40 flex items-end md:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div ref={panel} className="sheet-in relative w-full md:max-w-lg max-h-[92%] overflow-y-auto overscroll-contain bg-surface rounded-t-2xl md:rounded-2xl shadow-2xl pb-[env(safe-area-inset-bottom)]">
        <div className="sticky top-0 bg-surface z-10 flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" className="btn btn-ghost -mr-3" onClick={onClose} aria-label="Lukk">
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="px-5 pb-5">{children}</div>
      </div>
    </div>
  )
}
