import { describe, expect, test } from 'bun:test'
import { formatWeiGwei } from '../src/widget/format'

describe('fee display and copying', () => {
  test('preserves low fees and never rounds a positive copied fee down', () => {
    expect(formatWeiGwei(100000n)).toBe('0.0001')
    expect(formatWeiGwei(1n, true)).toBe('0.000000001')
    expect(formatWeiGwei(1234567n, true)).toBe('0.001235')
    expect(formatWeiGwei(999999999n, true)).toBe('1')
    expect(formatWeiGwei(0n, true)).toBe('0')
  })
})
