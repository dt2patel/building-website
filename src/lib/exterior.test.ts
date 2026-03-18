import { describe, expect, it } from 'vitest'
import { createSeedProject } from '../config/seedProject'
import { floorBottomOffset, projectFloorFacadeGuides } from './exterior'

describe('projectFloorFacadeGuides', () => {
  it('projects east and west facades using north-south spacing', () => {
    const project = createSeedProject()
    const floor = project.floors[0]

    const east = projectFloorFacadeGuides(project, floor, 'east')
    const west = projectFloorFacadeGuides(project, floor, 'west')
    const eastLayers = east.guides.map((guide) => guide.layerType)

    expect(east.width).toBeCloseTo(60.85, 2)
    expect(west.width).toBeCloseTo(60.85, 2)
    expect(east.guides.some((guide) => guide.label.includes('Column'))).toBe(true)
    expect(eastLayers).toContain('structural')
  })

  it('projects north facades using west-east spacing', () => {
    const project = createSeedProject()
    const floor = project.floors[0]

    const north = projectFloorFacadeGuides(project, floor, 'north')

    expect(north.width).toBeCloseTo(25, 2)
  })
})

describe('floorBottomOffset', () => {
  it('stacks floors from ground upward using floor heights', () => {
    const project = createSeedProject()

    expect(floorBottomOffset(project, 'floor-ground')).toBe(0)
    expect(floorBottomOffset(project, 'floor-podium')).toBe(3.5)
    expect(floorBottomOffset(project, 'floor-01')).toBe(7)
  })
})
