import { describe, expect, test } from 'bun:test'
import { formatAge, formatWeiGwei } from '../src/widget/format'

describe('fee display and copying', () => {
  test('preserves low fees and never rounds a positive copied fee down', () => {
    expect(formatWeiGwei(100000n)).toBe('<0.001')
    expect(formatWeiGwei(1n, true)).toBe('0.001')
    expect(formatWeiGwei(1234567n, true)).toBe('0.002')
    expect(formatWeiGwei(69773271n)).toBe('0.07')
    expect(formatWeiGwei(217247997n, true)).toBe('0.218')
    expect(formatWeiGwei(999999999n, true)).toBe('1')
    expect(formatWeiGwei(0n, true)).toBe('0')
  })
})

describe('compact block ages', () => {
  test('keeps minute and hour transitions compact', () => {
    const now = Date.now()
    expect(formatAge(now - 59000)).toBe('59s')
    expect(formatAge(now - 60000)).toBe('60s')
    expect(formatAge(now - 99000)).toBe('99s')
    expect(formatAge(now - 100000)).toBe('1m')
    expect(formatAge(now - 119000)).toBe('1m')
    expect(formatAge(now - 120000)).toBe('2m')
    expect(formatAge(now - 3600000)).toBe('1h')
  })
})
