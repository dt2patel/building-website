import {
  distanceBetweenPoints,
  getBounds,
  isCloseTo,
  projectPointToSide,
} from './geometry'
import {
  getExteriorAssignment,
  type CardinalSide,
  type ExteriorTemplate,
  type Floor,
  type GridPoint,
  type LayerType,
  type PlanEntity,
  type Project,
} from '../types/planner'

export interface FacadeGuide {
  id: string
  kind: 'column' | 'wallFeature'
  label: string
  layerType: LayerType
  horizontalStart: number
  horizontalEnd: number
}

export interface FacadeProjection {
  side: CardinalSide
  width: number
  height: number
  guides: FacadeGuide[]
}

function facadeAxisValue(bounds: ReturnType<typeof getBounds>, side: CardinalSide): number {
  switch (side) {
    case 'east':
      return bounds.maxX
    case 'west':
      return bounds.minX
    case 'north':
      return bounds.minY
    case 'south':
      return bounds.maxY
  }
}

function pointTouchesSide(
  point: GridPoint,
  bounds: ReturnType<typeof getBounds>,
  side: CardinalSide,
  epsilon = 0.2,
): boolean {
  const axisValue = facadeAxisValue(bounds, side)
  if (side === 'east' || side === 'west') {
    return isCloseTo(point.x, axisValue, epsilon)
  }

  return isCloseTo(point.y, axisValue, epsilon)
}

function entityTouchesSide(
  entity: PlanEntity,
  bounds: ReturnType<typeof getBounds>,
  side: CardinalSide,
): boolean {
  return entity.vertices.some((vertex) => pointTouchesSide(vertex, bounds, side))
}

function toFacadeGuide(
  entity: PlanEntity,
  bounds: ReturnType<typeof getBounds>,
  side: CardinalSide,
): FacadeGuide | null {
  if (!entityTouchesSide(entity, bounds, side)) {
    return null
  }

  if (entity.geometryType === 'point') {
    const horizontal = projectPointToSide(entity.vertices[0], bounds, side)
    return {
      id: entity.id,
      kind: entity.symbolKey === 'column' ? 'column' : 'wallFeature',
      label: entity.label,
      layerType: entity.layerType,
      horizontalStart: horizontal,
      horizontalEnd: horizontal,
    }
  }

  const touchedVertices = entity.vertices.filter((vertex) => pointTouchesSide(vertex, bounds, side))
  if (!touchedVertices.length) {
    return null
  }

  const projected = touchedVertices.map((vertex) => projectPointToSide(vertex, bounds, side))
  return {
    id: entity.id,
    kind: entity.symbolKey === 'column' || entity.label.toLowerCase().includes('column') ? 'column' : 'wallFeature',
    label: entity.label,
    layerType: entity.layerType,
    horizontalStart: Math.min(...projected),
    horizontalEnd: Math.max(...projected),
  }
}

export function exteriorTemplateMatchesFloor(template: ExteriorTemplate, floor: Floor, side: CardinalSide): boolean {
  return template.side === side && template.heightMeters === floor.heightMeters
}

export function facadeWidthFromBoundary(boundary: GridPoint[], side: CardinalSide): number {
  const bounds = getBounds(boundary)
  if (side === 'east' || side === 'west') {
    return bounds.maxY - bounds.minY
  }

  return bounds.maxX - bounds.minX
}

export function projectFloorFacadeGuides(project: Project, floor: Floor, side: CardinalSide): FacadeProjection {
  const perimeterId = floor.templateAssignments.perimeter
  const perimeterTemplate = project.templates.find((template) => template.id === perimeterId)
  const perimeterEntity = perimeterTemplate?.entities.find((entity) => entity.geometryType === 'polygon')
  const boundary = perimeterEntity?.vertices ?? project.buildingBoundary
  const bounds = getBounds(boundary)
  const width = facadeWidthFromBoundary(boundary, side)
  const guides = project.templates
    .filter((template) => Object.values(floor.templateAssignments).includes(template.id))
    .flatMap((template) => template.entities)
    .map((entity) => toFacadeGuide(entity, bounds, side))
    .filter((guide): guide is FacadeGuide => Boolean(guide))
    .sort((left, right) => {
      if (left.horizontalStart !== right.horizontalStart) {
        return left.horizontalStart - right.horizontalStart
      }

      if (left.horizontalEnd !== right.horizontalEnd) {
        return left.horizontalEnd - right.horizontalEnd
      }

      return left.label.localeCompare(right.label)
    })

  return {
    side,
    width,
    height: floor.heightMeters,
    guides,
  }
}

export function stackedElevationHeight(project: Project): number {
  return project.floors.reduce((total, floor) => total + floor.heightMeters, 0)
}

export function floorBottomOffset(project: Project, floorId: string): number {
  let offset = 0
  for (const floor of project.floors) {
    if (floor.id === floorId) {
      return offset
    }
    offset += floor.heightMeters
  }

  return offset
}

export function getAssignedExteriorTemplate(
  project: Project,
  floor: Floor,
  side: CardinalSide,
): ExteriorTemplate | null {
  const templateId = getExteriorAssignment(floor.exterior, side)
  return project.exteriorTemplates.find((template) => template.id === templateId) ?? null
}

export function facadeTemplateSpan(points: GridPoint[]): number {
  if (points.length < 2) {
    return 0
  }

  return points.slice(1).reduce((length, point, index) => {
    return length + distanceBetweenPoints(points[index], point)
  }, 0)
}
