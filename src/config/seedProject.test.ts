import { describe, expect, it } from 'vitest'
import { createSeedProject } from './seedProject'

describe('createSeedProject', () => {
  it('creates a seeded project with floors and reusable templates', () => {
    const project = createSeedProject()

    expect(project.floors).toHaveLength(10)
    expect(project.templates.length).toBeGreaterThanOrEqual(5)
    expect(project.exteriorTemplates.length).toBeGreaterThanOrEqual(8)
    expect(project.floors[0]?.templateAssignments.structural).toBe('tpl-structural-columns')
    expect(project.floors[0]?.templateAssignments.perimeter).toBe('tpl-perimeter-ground')
    expect(project.floors[0]?.heightMeters).toBe(3.5)
    expect(project.floors[0]?.exterior.east).toBe(null)
  })
})
