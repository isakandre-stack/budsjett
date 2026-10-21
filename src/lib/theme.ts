export type Theme = 'system' | 'light' | 'dark'

const KEY = 'budsjett-theme'

export function storedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    if (t === 'light' || t === 'dark' || t === 'system') return t
  } catch { /* privat modus */ }
  return 'system'
}

let mql: MediaQueryList | null = null

export function applyTheme(theme: Theme) {
  try { localStorage.setItem(KEY, theme) } catch { /* ignorer */ }
  const set = () => {
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
  }
  set()
  mql ??= window.matchMedia('(prefers-color-scheme: dark)')
  mql.onchange = theme === 'system' ? set : null
}
