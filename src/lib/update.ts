declare global {
  const __APP_VERSION__: string
}

export const appVersion = __APP_VERSION__

/**
 * Tar i bruk nye versjoner av appen automatisk. Før ble en ny versjon bare lastet ned i bakgrunnen,
 * og telefonen fortsatte med den gamle til appen ble startet helt på nytt.
 *
 * Sjekker etter oppdatering når appen åpnes og hver gang den kommer tilbake i forgrunnen.
 * Når den nye versjonen har tatt over, lastes appen inn på nytt, men aldri mens et
 * registreringsvindu er åpent, så ingenting du skriver går tapt.
 */
export function startUpdates() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  const sw = navigator.serviceWorker
  // Første gang appen installeres finnes ingen gammel versjon, og da skal ingenting lastes på nytt
  const hadController = !!sw.controller

  let reloading = false
  const reloadWhenIdle = () => {
    if (reloading) return
    if (document.querySelector('[role=dialog]')) { window.setTimeout(reloadWhenIdle, 1500); return }
    reloading = true
    window.location.reload()
  }
  sw.addEventListener('controllerchange', () => { if (hadController) reloadWhenIdle() })

  window.addEventListener('load', () => {
    sw.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).then((reg) => {
      const check = () => { void reg.update().catch(() => {}) }
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
      window.setInterval(check, 30 * 60 * 1000)
    }).catch(() => {})
  })
}
