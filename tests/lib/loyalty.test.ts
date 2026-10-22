import { describe, expect, it } from 'vitest'
import { PRESETS, detectPlatform, normalizeUrl, openUrl } from '../../src/lib/loyalty'

const trumf = PRESETS.find((a) => a.id === 'trumf')!

describe('detectPlatform', () => {
  it('kjenner igjen Android, iPhone og iPad som later som Mac', () => {
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android')
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios')
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ios')
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('other')
  })
})

describe('openUrl', () => {
  it('Android prøver å starte appen og faller tilbake til Google Play', () => {
    const u = openUrl(trumf, 'android')!
    expect(u.startsWith('intent://#Intent;package=no.norgesgruppen.apps.trumf.trumf;')).toBe(true)
    expect(u).toContain(encodeURIComponent('https://play.google.com/store/apps/details?id=no.norgesgruppen.apps.trumf.trumf'))
  })
  it('iPhone går via App Store', () => {
    expect(openUrl(trumf, 'ios')).toBe('https://apps.apple.com/no/app/id1481070828')
  })
  it('egne snarveier bruker sin egen lenke', () => {
    expect(openUrl({ id: 'x', name: 'X', color: '#000', url: 'https://apps.apple.com/no/app/id1' }, 'android')).toBe('https://apps.apple.com/no/app/id1')
  })
})

describe('normalizeUrl', () => {
  it('godtar vanlige lenker og app-adresser', () => {
    expect(normalizeUrl('apps.apple.com/no/app/id1')).toBe('https://apps.apple.com/no/app/id1')
    expect(normalizeUrl('trumf://')).toBe('trumf://')
  })
  it('avviser farlige og ugyldige lenker', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('data:text/html,hei')).toBeNull()
    expect(normalizeUrl('http://eksempel.no')).toBeNull()
    expect(normalizeUrl('hei')).toBeNull()
    expect(normalizeUrl('')).toBeNull()
  })
})
