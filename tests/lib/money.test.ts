import { describe, expect, it } from 'vitest'
import { formatOre, oreToInput, parseAmountToOre, parseQuickEntry } from '../../src/lib/money'

describe('parseAmountToOre', () => {
  it.each([
    ['249', 24900],
    ['249,5', 24950],
    ['249,50', 24950],
    ['249.50', 24950],
    ['0,01', 1],
    ['1 249,50', 124950],
    ['1 249,50', 124950],
    ['1.249,50', 124950],
    ['1,249.50', 124950],
    ['1.249', 124900],
    ['12.345.678', 1234567800],
    ['249 kr', 24900],
    ['249kr', 24900],
    ['249,-', 24900],
    ['0,1', 10],
    ['0,10', 10],
  ])('%s -> %i øre', (input, expected) => {
    expect(parseAmountToOre(input)).toBe(expected)
  })

  it.each(['', 'abc', '0', '0,00', '-5', '1,234,56', '1,2,3', '249,505', '1.2.3', '12,34.5', '1e5', '1000000000'])(
    'avviser %s', (input) => {
      expect(parseAmountToOre(input)).toBeNull()
    })

  it('unngår flyttallsfeil (0,1 + 0,2)', () => {
    expect(parseAmountToOre('0,1')! + parseAmountToOre('0,2')!).toBe(30)
    expect(parseAmountToOre('19,99')).toBe(1999)
    expect(parseAmountToOre('4,35')).toBe(435)
  })
})

describe('formatOre', () => {
  it('formaterer norsk', () => {
    expect(formatOre(124950)).toBe('1 249,50 kr')
    expect(formatOre(24900)).toBe('249 kr')
    expect(formatOre(24900, { decimals: 'always' })).toBe('249,00 kr')
    expect(formatOre(1)).toBe('0,01 kr')
    expect(formatOre(-5000)).toBe('−50 kr')
    expect(formatOre(5000, { sign: true })).toBe('+50 kr')
    expect(formatOre(123456789012)).toBe('1 234 567 890,12 kr')
    expect(formatOre(216950, { decimals: 'never' })).toBe('2 170 kr')
    expect(formatOre(216949, { decimals: 'never' })).toBe('2 169 kr')
    expect(formatOre(-8990, { decimals: 'never' })).toBe('−90 kr')
  })

  it('oreToInput er motsatt av parseAmountToOre', () => {
    for (const ore of [1, 99, 100, 24950, 124900, 99999999]) {
      expect(parseAmountToOre(oreToInput(ore))).toBe(ore)
    }
  })
})

describe('parseQuickEntry', () => {
  it.each([
    ['249 REMA', 24900, 'REMA', false],
    ['249 rema 1000', 24900, 'rema 1000', false],
    ['REMA 249', 24900, 'REMA', false],
    ['Rema 1000 249,90', 24990, 'Rema 1000', false],
    ['1 249,50 Elkjøp', 124950, 'Elkjøp', false],
    ['  89,90   Narvesen  ', 8990, 'Narvesen', false],
    ['249', 24900, '', false],
    ['249 kr Kiwi', 24900, 'Kiwi', false],
    ['+32000 Lønn', 3200000, 'Lønn', true],
    ['7-Eleven 45', 4500, '7-Eleven', false],
  ])('%s', (input, ore, merchant, income) => {
    expect(parseQuickEntry(input)).toEqual({ amountOre: ore, merchant, income })
  })

  it.each(['', 'REMA', 'abc def', '0 REMA', '+'])('avviser %s', (input) => {
    expect(parseQuickEntry(input)).toBeNull()
  })
})
