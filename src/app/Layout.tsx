import { useEffect, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useApp } from './AppContext'
import { Logo } from '../components/Logo'
import { QuickAdd } from '../components/QuickAdd'
import { TxEditor } from '../components/TxEditor'

const icons: Record<string, ReactNode> = {
  oversikt: <path d="M4 13h4v7H4zM10 8h4v12h-4zM16 4h4v16h-4z" fill="currentColor" />,
  transaksjoner: <path d="M5 6h14M5 12h14M5 18h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  innstillinger: (
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" strokeLinecap="round" />
    </g>
  ),
}

const NAV = [
  { to: '/', label: 'Oversikt', icon: 'oversikt', end: true },
  { to: '/transaksjoner', label: 'Transaksjoner', icon: 'transaksjoner', end: false },
  { to: '/innstillinger', label: 'Innstillinger', icon: 'innstillinger', end: false },
]

const Icon = ({ name }: { name: string }) => <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">{icons[name]}</svg>
const Plus = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
)

export function Layout() {
  const { setQuickOpen, quickOpen, editor } = useApp()

  // Tastatursnarvei: N åpner registrering
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (quickOpen || editor || e.metaKey || e.ctrlKey || e.altKey) return
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setQuickOpen(true) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [quickOpen, editor, setQuickOpen])

  return (
    <div className="md:flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-3 focus:bg-surface">Hopp til innhold</a>

      {/* Sidemeny på større skjermer */}
      <aside className="hidden md:flex md:flex-col w-60 shrink-0 border-r border-line px-4 py-6 sticky top-0 h-dvh">
        <div className="flex items-center gap-2 px-2 mb-8"><Logo /><span className="font-bold text-lg">Budsjett</span></div>
        <button className="btn btn-primary mb-6 w-full" onClick={() => setQuickOpen(true)} title="Snarvei: N">
          <Plus size={20} /> Registrer kjøp
        </button>
        <nav className="space-y-1" aria-label="Hovedmeny">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium ${isActive ? 'bg-accent-soft text-ink' : 'text-muted hover:bg-sunken'}`}>
              <Icon name={n.icon} />{n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main id="main" className="flex-1 min-w-0 pb-28 md:pb-10">
        <Outlet />
      </main>

      {/* Bunnmeny på mobil, med stor registreringsknapp i midten */}
      <nav aria-label="Hovedmeny" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4 items-center h-16">
          {NAV.slice(0, 2).map((n) => <MobileLink key={n.to} {...n} />)}
          <div className="flex justify-center">
            <button onClick={() => setQuickOpen(true)} aria-label="Registrer kjøp"
              className="-mt-8 size-16 rounded-full bg-accent text-accent-ink grid place-items-center shadow-lg ring-4 ring-bg active:scale-95 transition-transform">
              <Plus />
            </button>
          </div>
          <MobileLink {...NAV[2]} />
        </div>
      </nav>

      <QuickAdd />
      <TxEditor />
    </div>
  )
}

function MobileLink({ to, label, icon, end }: (typeof NAV)[number]) {
  return (
    <NavLink to={to} end={end}
      className={({ isActive }) => `flex flex-col items-center gap-0.5 text-[11px] font-medium ${isActive ? 'text-accent' : 'text-muted'}`}>
      <Icon name={icon} />{label}
    </NavLink>
  )
}
