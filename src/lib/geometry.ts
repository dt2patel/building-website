import type { GridPoint, PlanEntity } from '../types/planner'

export function snapToGrid(point: GridPoint, spacing: number): GridPoint {
  return {
    x: Math.round(point.x / spacing) * spacing,
    y: Math.round(point.y / spacing) * spacing,
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
