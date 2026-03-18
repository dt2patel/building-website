import type {
  EntityStyle,
  GridPoint,
  LayerType,
  MeasurementUnit,
  PlanEntity,
  ToolMode,
} from '../../types/planner'

export interface ViewBoxGeometry {
  minX: number
  minY: number
  width: number
  height: number
}

export interface CanvasGridRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasGrid {
  spacing: number
  unit: MeasurementUnit
  rect: CanvasGridRect
}

export interface CanvasEntityPresentation {
  entity: PlanEntity
  selectionLayerType?: LayerType
  dimmed?: boolean
  showLabel?: boolean
  labelClass?: string | string[] | Record<string, boolean>
  labelOffset?: GridPoint
}

export type CanvasScreenToWorld = (
  event: PointerEvent | MouseEvent,
  svg: SVGSVGElement,
  geometry: ViewBoxGeometry,
) => GridPoint | null

export type CanvasWorldToSvg = (point: GridPoint) => GridPoint

export interface DesignCanvasProps {
  headerEyebrow: string
  headerTitle: string
  headerHint?: string
  readonlyHint?: string
  hoverEmptyLabel: string
  editable: boolean
  toolMode: ToolMode
  selectedEntityId: string | null
  draftStyle: EntityStyle
  draftVertices: GridPoint[]
  viewBoxGeometry: ViewBoxGeometry
  grid?: CanvasGrid
  entities: CanvasEntityPresentation[]
  screenToWorld: CanvasScreenToWorld
  worldToSvg: CanvasWorldToSvg
}

export function projectClientPointToViewBox(
  event: PointerEvent | MouseEvent,
  svg: SVGSVGElement,
  geometry: ViewBoxGeometry,
): GridPoint {
  const rect = svg.getBoundingClientRect()

  return {
    x: ((event.clientX - rect.left) / rect.width) * geometry.width + geometry.minX,
    y: ((event.clientY - rect.top) / rect.height) * geometry.height + geometry.minY,
  }
}
