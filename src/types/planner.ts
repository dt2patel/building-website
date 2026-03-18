export const layerOrder = [
  'perimeter',
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
export type MeasurementUnit = 'm' | 'cm'
export type UserRole = 'admin' | 'user'
export type CardinalSide = 'east' | 'west' | 'north' | 'south'

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

export interface ExteriorTemplate {
  id: string
  name: string
  side: CardinalSide
  heightMeters: number
  version: number
  status: 'active' | 'draft'
  entities: PlanEntity[]
  updatedAt: string
}

export interface ExteriorAssignments {
  east: string | null
  west: string | null
  north: string | null
  south: string | null
}

export interface Floor {
  id: string
  name: string
  index: number
  floorType: FloorType
  heightMeters: number
  templateAssignments: Record<LayerType, string | null>
  exterior: ExteriorAssignments
}

export interface ProjectState {
  schemaVersion: number
  units: 'm'
  gridUnit: MeasurementUnit
  gridSpacing: number
  plotBoundary: GridPoint[]
  buildingBoundary: GridPoint[]
  fixedStructures: PlanEntity[]
  floors: Floor[]
  templates: Template[]
  exteriorTemplates: ExteriorTemplate[]
  createdAt: string
  updatedAt: string
}

export interface Project extends ProjectState {
  id: string
  name: string
}

export interface ProjectMeta {
  id: string
  name: string
  archived: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
  defaultSaveId: string
  lastOpenedSaveId?: string
  migrationVersion?: number
}

export interface ProjectSaveRecord extends Omit<ProjectState, 'floors' | 'templates' | 'exteriorTemplates'> {
  id: string
  name: string
  archived: boolean
  isDefault: boolean
  parentSaveId: string | null
  sourceProjectId: string | null
  createdBy: string
}

export interface ProjectSaveSummary {
  id: string
  name: string
  archived: boolean
  isDefault: boolean
  parentSaveId: string | null
  sourceProjectId: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface ProjectMembership {
  projectId: string
  projectName: string
  canEdit: boolean
  archived: boolean
  addedAt: string
  updatedAt: string
}

export interface ProjectMember {
  uid: string
  username: string
  canEdit: boolean
  addedAt: string
  updatedAt: string
}

export interface UserProfile {
  uid: string
  username: string
  normalizedUsername: string
  role: UserRole
  archived: boolean
  blocked: boolean
  blockedAt?: string
  blockedBy?: string
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
  perimeter: 'Perimeter',
  structural: 'Structural',
  plumbing: 'Plumbing',
  fireSafety: 'Fire Safety',
  electrical: 'Electrical',
  custom: 'Custom',
}

export const layerColors: Record<LayerType, string> = {
  perimeter: '#374151',
  structural: '#1d4ed8',
  plumbing: '#0f766e',
  fireSafety: '#b91c1c',
  electrical: '#ca8a04',
  custom: '#7c3aed',
}

export function createEmptyAssignments(): Record<LayerType, string | null> {
  return {
    perimeter: null,
    structural: null,
    plumbing: null,
    fireSafety: null,
    electrical: null,
    custom: null,
  }
}

export function createEmptyExteriorAssignments(): ExteriorAssignments {
  return {
    east: null,
    west: null,
    north: null,
    south: null,
  }
}

export function getExteriorAssignment(
  exterior: ExteriorAssignments,
  side: CardinalSide,
): string | null {
  switch (side) {
    case 'east':
      return exterior.east
    case 'west':
      return exterior.west
    case 'north':
      return exterior.north
    case 'south':
      return exterior.south
  }
}

export function setExteriorAssignment(
  exterior: ExteriorAssignments,
  side: CardinalSide,
  templateId: string | null,
) {
  switch (side) {
    case 'east':
      exterior.east = templateId
      return
    case 'west':
      exterior.west = templateId
      return
    case 'north':
      exterior.north = templateId
      return
    case 'south':
      exterior.south = templateId
      return
  }
}
