import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface ToastItem {
  id: number
  text: string
  action?: { label: string; run: () => void }
  tone?: 'ok' | 'error'
}

const ToastCtx = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => {})

export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = nextId.current++
    setItems((xs) => [...xs.slice(-2), { ...t, id }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.action ? 6000 : 3500)
  }, [])

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed z-50 left-0 right-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-6 flex flex-col items-center gap-2 px-4 pointer-events-none">
        {items.map((t) => (
          <div key={t.id} className={`sheet-in pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg max-w-md w-full ${t.tone === 'error' ? 'bg-bad text-white' : 'bg-ink text-bg'}`}>
            <span className="flex-1 text-sm">{t.text}</span>
            {t.action && (
              <button className="text-sm font-semibold underline underline-offset-2" onClick={() => { t.action!.run(); setItems((xs) => xs.filter((x) => x.id !== t.id)) }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
