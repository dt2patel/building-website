import { describe, expect, it } from 'vitest'
import { snapToGrid } from './geometry'

describe('snapToGrid', () => {
  it('rounds coordinates to the nearest spacing', () => {
    expect(snapToGrid({ x: 13.1, y: 9.2 }, 2, 'm')).toEqual({ x: 14, y: 10 })
  })
})
