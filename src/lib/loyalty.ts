// Snarveier til kundeprogram-apper (Trumf, Coop og egne).
// Ingen økonomidata her, bare lenker. Egne snarveier lagres i nettleseren på denne enheten.

export type Platform = 'android' | 'ios' | 'other'

export interface LoyaltyApp {
  id: string
  name: string
  color: string
  /** Pakkenavn i Google Play */
  android?: string
  /** App Store-id (tallet i id123456789) */
  ios?: string
  /** Navnet på snarveien i Snarveier-appen på iPhone, som åpner appen direkte */
  shortcut?: string
  /** Egen lenke, brukes for snarveier du legger til selv */
  url?: string
  custom?: boolean
}

export const PRESETS: LoyaltyApp[] = [
  { id: 'trumf', name: 'Trumf', color: '#e2001a', android: 'no.norgesgruppen.apps.trumf.trumf', ios: '1481070828', shortcut: 'Trumf' },
  { id: 'coop', name: 'Coop medlem', color: '#004b93', android: 'no.coop.members', ios: '992134528', shortcut: 'Coop' },
]

export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  // iPad med iPadOS 13+ later som Mac
  if (/macintosh/i.test(ua) && maxTouchPoints > 1) return 'ios'
  return 'other'
}

export const playUrl = (pkg: string) => `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}`
export const shortcutUrl = (name: string) => `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`
export const appStoreUrl = (id: string) => `https://apps.apple.com/no/app/id${encodeURIComponent(id)}`

/**
 * Lenken som åpner appen.
 * Android: Chrome prøver å starte appen direkte, og faller tilbake til Google Play (med Åpne-knapp).
 * iPhone: Safari kan ikke starte andre apper direkte, men kan kjøre en snarvei i Snarveier-appen
 * som åpner appen. Uten snarvei går vi via App Store, der knappen heter Åpne.
 */
export function openUrl(app: LoyaltyApp, platform: Platform): string | null {
  if (app.url) return app.url
  if (platform === 'android' && app.android) {
    return `intent://#Intent;package=${app.android};S.browser_fallback_url=${encodeURIComponent(playUrl(app.android))};end`
  }
  if (platform === 'ios' && app.shortcut) return shortcutUrl(app.shortcut)
  if (platform === 'ios' && app.ios) return appStoreUrl(app.ios)
  if (app.ios) return appStoreUrl(app.ios)
  if (app.android) return playUrl(app.android)
  return null
}

/** Godtar https-lenker og app-adresser (for eksempel trumf://), men ikke javascript: og lignende. */
export function normalizeUrl(input: string): string | null {
  const t = input.trim()
  if (!t) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`
  let u: URL
  try { u = new URL(withScheme) } catch { return null }
  const scheme = u.protocol.slice(0, -1).toLowerCase()
  if (['javascript', 'data', 'vbscript', 'file', 'blob'].includes(scheme)) return null
  if (scheme === 'http') return null
  if (scheme === 'https' && !u.hostname.includes('.')) return null
  return u.toString()
}

const KEY = 'budsjett.kundeprogram'

export function loadCustom(): LoyaltyApp[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return list
      .filter((a) => a && typeof a.name === 'string' && typeof a.url === 'string' && normalizeUrl(a.url))
      .map((a) => ({ id: String(a.id), name: a.name, url: a.url, color: typeof a.color === 'string' ? a.color : '#5b6b64', custom: true }))
  } catch {
    return []
  }
}

export function saveCustom(list: LoyaltyApp[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.map(({ id, name, url, color }) => ({ id, name, url, color }))))
    return true
  } catch {
    return false
  }
}
