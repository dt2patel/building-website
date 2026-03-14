export const layerOrder = [
  'structural',
  'plumbing',
  'fireSafety',
  'electrical',
  'custom',
] as const

export type LayerType = (typeof layerOrder)[number]
export type GeometryType = 'point' | 'polyline' | 'polygon'
export type ToolMode = 'select' | 'point' | 'polyline' | 'polygon'
export type FloorType = 'garage' | 'office' | 'residential'
export type SyncState = 'local' | 'syncing' | 'synced' | 'error'

export interface GridPoint {
  x: number
  y: number
}

export interface EntityStyle {
  stroke: string
  fill: string
  strokeWidth: number
  opacity: number
  dashed?: boolean
}

export interface PlanEntity {
  id: string
  layerType: LayerType
  geometryType: GeometryType
  label: string
  description: string
  symbolKey?: string
  vertices: GridPoint[]
  style: EntityStyle
  metadata: Record<string, string>
}

export interface Template {
  id: string
  name: string
  layerType: LayerType
  version: number
  status: 'active' | 'draft'
  entities: PlanEntity[]
  updatedAt: string
}

export interface Floor {
  id: string
  name: string
  index: number
  floorType: FloorType
  templateAssignments: Record<LayerType, string | null>
}

export interface Project {
  id: string
  name: string
  units: string
  gridSpacing: number
  plotBoundary: GridPoint[]
  buildingBoundary: GridPoint[]
  fixedStructures: PlanEntity[]
  floors: Floor[]
  templates: Template[]
  createdAt: string
  updatedAt: string
}

export interface ExportRecord {
  id: string
  floorId: string
  floorName: string
  storagePath: string
  downloadUrl?: string
  visibleLayers: LayerType[]
  createdAt: string
}

export const layerLabels: Record<LayerType, string> = {
  structural: 'Structural',
  plumbing: 'Plumbing',
  fireSafety: 'Fire Safety',
  electrical: 'Electrical',
  custom: 'Custom',
}

export const layerColors: Record<LayerType, string> = {
  structural: '#1d4ed8',
  plumbing: '#0f766e',
  fireSafety: '#b91c1c',
  electrical: '#ca8a04',
  custom: '#7c3aed',
}

export function createEmptyAssignments(): Record<LayerType, string | null> {
  return {
    structural: null,
    plumbing: null,
    fireSafety: null,
    electrical: null,
    custom: null,
  }
}
