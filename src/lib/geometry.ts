import type { GridPoint, MeasurementUnit, PlanEntity } from '../types/planner'

export function gridSpacingInMeters(spacing: number, unit: MeasurementUnit): number {
  return unit === 'm' ? spacing : spacing / 100
}

export function snapToGrid(
  point: GridPoint,
  spacing: number,
  unit: MeasurementUnit,
): GridPoint {
  const spacingInMeters = gridSpacingInMeters(spacing, unit)
  return {
    x: Math.round(point.x / spacingInMeters) * spacingInMeters,
    y: Math.round(point.y / spacingInMeters) * spacingInMeters,
  }
}

export function pointsToPath(points: GridPoint[], close = false): string {
  if (!points.length) {
    return ''
  }

  const segments = points.map((point, index) =>
    `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`,
  )

  return `${segments.join(' ')}${close ? ' Z' : ''}`
}

export function entityCenter(entity: PlanEntity): GridPoint {
  if (entity.geometryType === 'point') {
    return entity.vertices[0]
  }

  const totals = entity.vertices.reduce(
    (accumulator, vertex) => ({
      x: accumulator.x + vertex.x,
      y: accumulator.y + vertex.y,
    }),
    { x: 0, y: 0 },
  )

  return {
    x: totals.x / entity.vertices.length,
    y: totals.y / entity.vertices.length,
  }
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function getBounds(points: GridPoint[]) {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

export function formatCoordinate(valueInMeters: number, unit: MeasurementUnit): string {
  if (unit === 'cm') {
    return `${Math.round(valueInMeters * 100)} cm`
  }

  return `${valueInMeters.toFixed(2)} m`
}

export function toDisplayValue(valueInMeters: number, unit: MeasurementUnit): number {
  return unit === 'cm'
    ? Number((valueInMeters * 100).toFixed(0))
    : Number(valueInMeters.toFixed(2))
}

export function fromDisplayValue(value: number, unit: MeasurementUnit): number {
  return unit === 'cm' ? value / 100 : value
}
