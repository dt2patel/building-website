import { cloneJson } from './geometry'
import { createSeedProject } from '../config/seedProject'
import {
  createEmptyAssignments,
  layerColors,
  type GeometryType,
  type LayerType,
  type PlanEntity,
  type Project,
  type ProjectSaveRecord,
  type ProjectSaveSummary,
  type ProjectState,
  type UserProfile,
} from '../types/planner'

export const LEGACY_PROJECT_ID = createSeedProject().id

export function timestamp() {
  return new Date().toISOString()
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export function normalizeUsername(value: string): string {
  return slugify(value)
}

export function pseudoEmailForUsername(username: string): string {
  return `${normalizeUsername(username)}@planner.local`
}

export function autoSaveName(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `Save ${year}-${month}-${day} ${hours}:${minutes}`
}

export function createDefaultEntityStyle(layerType: LayerType, geometryType: GeometryType) {
  if (geometryType === 'point') {
    return {
      stroke: layerColors[layerType],
      fill: '#ffffff',
      strokeWidth: 0.22,
      opacity: 1,
    }
  }

  if (geometryType === 'polyline') {
    return {
      stroke: layerColors[layerType],
      fill: 'none',
      strokeWidth: layerType === 'perimeter' ? 0.28 : 0.38,
      opacity: 0.95,
    }
  }

  return {
    stroke: layerColors[layerType],
    fill: `${layerColors[layerType]}33`,
    strokeWidth: layerType === 'perimeter' ? 0.28 : 0.38,
    opacity: 0.95,
  }
}

export function createProjectStateFromSeed(): ProjectState {
  const seed = createSeedProject()
  return {
    schemaVersion: seed.schemaVersion,
    units: seed.units,
    gridUnit: seed.gridUnit,
    gridSpacing: seed.gridSpacing,
    plotBoundary: cloneJson(seed.plotBoundary),
    buildingBoundary: cloneJson(seed.buildingBoundary),
    fixedStructures: cloneJson(seed.fixedStructures),
    floors: cloneJson(seed.floors),
    templates: cloneJson(seed.templates),
    createdAt: seed.createdAt,
    updatedAt: seed.updatedAt,
  }
}

export function withProjectMeta(meta: { id: string; name: string }, state: ProjectState): Project {
  return {
    id: meta.id,
    name: meta.name,
    ...cloneJson(state),
  }
}

export function toProjectState(project: Project): ProjectState {
  return {
    schemaVersion: project.schemaVersion,
    units: project.units,
    gridUnit: project.gridUnit,
    gridSpacing: project.gridSpacing,
    plotBoundary: cloneJson(project.plotBoundary),
    buildingBoundary: cloneJson(project.buildingBoundary),
    fixedStructures: cloneJson(project.fixedStructures),
    floors: cloneJson(project.floors),
    templates: cloneJson(project.templates),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

export function toSaveRecord(
  save: Pick<ProjectSaveSummary, 'id' | 'name' | 'archived' | 'isDefault' | 'parentSaveId' | 'sourceProjectId' | 'createdBy'>,
  state: ProjectState,
): ProjectSaveRecord {
  return {
    ...save,
    schemaVersion: state.schemaVersion,
    units: state.units,
    gridUnit: state.gridUnit,
    gridSpacing: state.gridSpacing,
    plotBoundary: cloneJson(state.plotBoundary),
    buildingBoundary: cloneJson(state.buildingBoundary),
    fixedStructures: cloneJson(state.fixedStructures),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  }
}

export function createProjectStateCopy(project: Project): Project {
  return cloneJson(project)
}

export function createNewProjectName(profile: UserProfile | null, sourceName?: string) {
  if (sourceName) {
    return `${sourceName} copy`
  }

  const ownerName = profile?.username ?? 'Planner'
  return `${ownerName} Project`
}

export function entityLabel(layerType: LayerType, geometryType: PlanEntity['geometryType'], count: number) {
  return `${layerType} ${geometryType} ${count}`
}

export function parseTimestamp(value: string | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

export function projectsMatch(left: Project, right: Project): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function cloneFloorAssignments() {
  return createEmptyAssignments()
}
