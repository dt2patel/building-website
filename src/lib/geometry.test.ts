import { describe, expect, it } from 'vitest'
import { clampToRange, snapToGrid } from './geometry'

describe('snapToGrid', () => {
  it('rounds coordinates to the nearest spacing', () => {
    expect(snapToGrid({ x: 13.1, y: 9.2 }, 2, 'm')).toEqual({ x: 14, y: 10 })
  })
})

describe('clampToRange', () => {
  it('clamps values to the provided bounds', () => {
    expect(clampToRange(-2, 0, 10)).toBe(0)
    expect(clampToRange(4, 0, 10)).toBe(4)
    expect(clampToRange(12, 0, 10)).toBe(10)
  })
})
