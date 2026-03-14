import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { createSeedProject } from '../config/seedProject'
import { cloneJson } from '../lib/geometry'
import { getFirebaseServices, isFirebaseConfigured } from './firebase'
import { layerOrder, type ExportRecord, type LayerType, type PlanEntity, type Project, type Template } from '../types/planner'

const localStorageKey = 'blueprint-planner:project'
const seedProjectId = createSeedProject().id

export interface ProjectRealtimeState {
  exists: boolean
  hasPendingWrites: boolean
  live: boolean
}

interface RemoteTemplate extends Omit<Template, 'entities'> {
  entities?: PlanEntity[]
  entitiesById?: Record<string, PlanEntity>
  entityOrder?: string[]
}

function getLocalProject(): Project | null {
  const rawValue = window.localStorage.getItem(localStorageKey)
  if (!rawValue) {
    return null
  }

  try {
    return JSON.parse(rawValue) as Project
  } catch {
    window.localStorage.removeItem(localStorageKey)
    return null
  }
}

function saveLocalProject(project: Project) {
  window.localStorage.setItem(localStorageKey, JSON.stringify(project))
}

function normalizeEntityStyle(entity: PlanEntity): PlanEntity {
  const maxStrokeWidth =
    entity.geometryType === 'point'
      ? 0.22
      : entity.geometryType === 'polyline'
        ? 0.28
        : entity.layerType === 'perimeter'
          ? 0.28
          : 0.38

  return {
    ...entity,
    style: {
      ...entity.style,
      strokeWidth: Math.min(entity.style.strokeWidth ?? maxStrokeWidth, maxStrokeWidth),
    },
  }
}

function mapTemplateEntities(template: RemoteTemplate): PlanEntity[] {
  if (template.entitiesById) {
    const entityMap = Object.fromEntries(
      Object.entries(template.entitiesById).map(([entityId, entity]) => [
        entityId,
        normalizeEntityStyle({
          ...entity,
          id: entity.id ?? entityId,
        }),
      ]),
    )

    const orderedIds = template.entityOrder?.filter((entityId) => entityMap[entityId]) ?? []
    const unorderedIds = Object.keys(entityMap).filter((entityId) => !orderedIds.includes(entityId))

    return [...orderedIds, ...unorderedIds].map((entityId) => entityMap[entityId])
  }

  return (template.entities ?? []).map((entity) => normalizeEntityStyle(entity))
}

function serializeTemplate(template: Template): RemoteTemplate {
  return {
    id: template.id,
    name: template.name,
    layerType: template.layerType,
    version: template.version,
    status: template.status,
    updatedAt: template.updatedAt,
    entityOrder: template.entities.map((entity) => entity.id),
    entitiesById: Object.fromEntries(template.entities.map((entity) => [entity.id, entity])),
  }
}

function normalizeProject(project: Project): Project {
  const seed = createSeedProject()
  const schemaVersion = project.schemaVersion ?? seed.schemaVersion

  if (schemaVersion !== seed.schemaVersion) {
    return seed
  }

  return {
    ...project,
    schemaVersion,
    gridUnit: project.gridUnit ?? seed.gridUnit,
    floors: seed.floors.map((seedFloor) => {
      const floor =
        (project.floors ?? []).find((item) => item.id === seedFloor.id) ??
        (project.floors ?? []).find((item) => item.index === seedFloor.index) ??
        seedFloor

      return {
        ...seedFloor,
        ...floor,
        templateAssignments: {
          ...seedFloor.templateAssignments,
          ...floor.templateAssignments,
        },
      }
    }),
    templates: (project.templates ?? seed.templates).map((template) => ({
      ...template,
      entities: mapTemplateEntities(template as RemoteTemplate),
    })),
  }
}

function parseTimestamp(value: string | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

async function loadRemoteProject(projectId: string): Promise<Project | null> {
  if (!isFirebaseConfigured()) {
    return null
  }

  const services = getFirebaseServices()
  if (!services) {
    return null
  }

  const projectDoc = await getDoc(doc(services.db, 'projects', projectId))
  if (!projectDoc.exists()) {
    return null
  }

  const [floorsSnapshot, templatesSnapshot] = await Promise.all([
    getDocs(collection(services.db, 'projects', projectId, 'floors')),
    getDocs(collection(services.db, 'projects', projectId, 'templates')),
  ])

  return normalizeProject({
    ...(projectDoc.data() as Project),
    floors: floorsSnapshot.docs.map((item) => item.data()) as Project['floors'],
    templates: templatesSnapshot.docs.map((item) => item.data()) as Project['templates'],
  })
}

export function subscribeToProject(
  projectId: string,
  handlers: {
    onProject: (project: Project) => void
    onStateChange: (state: ProjectRealtimeState) => void
    onError: (error: Error) => void
  },
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    return () => undefined
  }

  const services = getFirebaseServices()
  if (!services) {
    return () => undefined
  }

  const projectRef = doc(services.db, 'projects', projectId)
  const floorsRef = collection(services.db, 'projects', projectId, 'floors')
  const templatesRef = collection(services.db, 'projects', projectId, 'templates')

  let projectSnapshot: Awaited<ReturnType<typeof getDoc>> | null = null
  let floorsSnapshot: QuerySnapshot | null = null
  let templatesSnapshot: QuerySnapshot | null = null

  function emitState() {
    if (!projectSnapshot || !floorsSnapshot || !templatesSnapshot) {
      return
    }

    const hasPendingWrites =
      projectSnapshot.metadata.hasPendingWrites ||
      floorsSnapshot.metadata.hasPendingWrites ||
      templatesSnapshot.metadata.hasPendingWrites
    const live =
      !projectSnapshot.metadata.fromCache &&
      !floorsSnapshot.metadata.fromCache &&
      !templatesSnapshot.metadata.fromCache

    handlers.onStateChange({
      exists: projectSnapshot.exists(),
      hasPendingWrites,
      live,
    })

    if (!projectSnapshot.exists()) {
      return
    }

    handlers.onProject(
      normalizeProject({
        ...(projectSnapshot.data() as Project),
        floors: floorsSnapshot.docs.map((item) => item.data()) as Project['floors'],
        templates: templatesSnapshot.docs.map((item) => item.data()) as Project['templates'],
      }),
    )
  }

  const listenOptions = { includeMetadataChanges: true }
  const unsubscribers: Unsubscribe[] = [
    onSnapshot(
      projectRef,
      listenOptions,
      (snapshot) => {
        projectSnapshot = snapshot
        emitState()
      },
      (error) => {
        handlers.onError(error)
      },
    ),
    onSnapshot(
      floorsRef,
      listenOptions,
      (snapshot) => {
        floorsSnapshot = snapshot
        emitState()
      },
      (error) => {
        handlers.onError(error)
      },
    ),
    onSnapshot(
      templatesRef,
      listenOptions,
      (snapshot) => {
        templatesSnapshot = snapshot
        emitState()
      },
      (error) => {
        handlers.onError(error)
      },
    ),
  ]

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe())
  }
}

export async function loadProject(): Promise<Project> {
  const localProject = getLocalProject()
  const normalizedLocalProject = localProject ? normalizeProject(localProject) : null

  try {
    const remoteProject = await loadRemoteProject(seedProjectId)
    if (remoteProject) {
      const remoteUpdatedAt = parseTimestamp(remoteProject.updatedAt)
      const localUpdatedAt = parseTimestamp(normalizedLocalProject?.updatedAt)

      if (!normalizedLocalProject || remoteUpdatedAt >= localUpdatedAt) {
        saveLocalProject(remoteProject)
        return remoteProject
      }
    }
  } catch {
    if (normalizedLocalProject) {
      return normalizedLocalProject
    }
  }

  if (normalizedLocalProject) {
    return normalizedLocalProject
  }

  const seed = createSeedProject()
  saveLocalProject(seed)
  return seed
}

function getChangedRootFields(previousProject: Project | null, nextProject: Project) {
  const patch: Record<string, unknown> = {}
  const rootFields: Array<keyof Project> = [
    'schemaVersion',
    'id',
    'name',
    'units',
    'gridUnit',
    'gridSpacing',
    'plotBoundary',
    'buildingBoundary',
    'fixedStructures',
    'createdAt',
    'updatedAt',
  ]

  rootFields.forEach((field) => {
    if (JSON.stringify(previousProject?.[field]) !== JSON.stringify(nextProject[field])) {
      patch[field] = cloneJson(nextProject[field])
    }
  })

  return patch
}

function getProjectTemplates(project: Project) {
  return Object.fromEntries(project.templates.map((template) => [template.id, template]))
}

function getProjectFloors(project: Project) {
  return Object.fromEntries(project.floors.map((floor) => [floor.id, floor]))
}

function jsonEquals(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export async function saveProject(
  previousProject: Project | null,
  project: Project,
): Promise<void> {
  const snapshot = cloneJson(project)
  const previousSnapshot = previousProject ? cloneJson(previousProject) : null
  saveLocalProject(snapshot)

  const services = getFirebaseServices()
  if (!services) {
    return
  }

  const batch = writeBatch(services.db)
  const projectRef = doc(services.db, 'projects', snapshot.id)
  let hasWrites = false
  const rootPatch = getChangedRootFields(previousSnapshot, snapshot)
  if (Object.keys(rootPatch).length > 0 || !previousSnapshot) {
    batch.set(projectRef, rootPatch, { merge: true })
    hasWrites = true
  }

  const previousFloors = previousSnapshot ? getProjectFloors(previousSnapshot) : {}
  snapshot.floors.forEach((floor) => {
    const previousFloor = previousFloors[floor.id]
    const floorRef = doc(services.db, 'projects', snapshot.id, 'floors', floor.id)

    if (!previousFloor) {
      batch.set(floorRef, floor)
      hasWrites = true
      return
    }

    const floorPatch: Record<string, unknown> = {}
    if (previousFloor.name !== floor.name) {
      floorPatch.name = floor.name
    }
    if (previousFloor.index !== floor.index) {
      floorPatch.index = floor.index
    }
    if (previousFloor.floorType !== floor.floorType) {
      floorPatch.floorType = floor.floorType
    }

    layerOrder.forEach((layerType) => {
      if (previousFloor.templateAssignments[layerType] !== floor.templateAssignments[layerType]) {
        floorPatch[`templateAssignments.${layerType}`] = floor.templateAssignments[layerType]
      }
    })

    if (Object.keys(floorPatch).length > 0) {
      batch.set(floorRef, floorPatch, { merge: true })
      hasWrites = true
    }
  })

  const previousTemplates = previousSnapshot ? getProjectTemplates(previousSnapshot) : {}
  snapshot.templates.forEach((template) => {
    const previousTemplate = previousTemplates[template.id]
    const templateRef = doc(services.db, 'projects', snapshot.id, 'templates', template.id)

    if (!previousTemplate) {
      batch.set(templateRef, serializeTemplate(template))
      hasWrites = true
      return
    }

    const templatePatch: Record<string, unknown> = {}
    ;(['name', 'layerType', 'version', 'status', 'updatedAt'] as const).forEach((field) => {
      if (!jsonEquals(previousTemplate[field], template[field])) {
        templatePatch[field] = template[field]
      }
    })

    const previousEntityOrder = previousTemplate.entities.map((entity) => entity.id)
    const currentEntityOrder = template.entities.map((entity) => entity.id)
    if (!jsonEquals(previousEntityOrder, currentEntityOrder)) {
      templatePatch.entityOrder = currentEntityOrder
    }

    const previousEntities = Object.fromEntries(previousTemplate.entities.map((entity) => [entity.id, entity]))
    const currentEntities = Object.fromEntries(template.entities.map((entity) => [entity.id, entity]))

    currentEntityOrder.forEach((entityId) => {
      if (!jsonEquals(previousEntities[entityId], currentEntities[entityId])) {
        templatePatch[`entitiesById.${entityId}`] = currentEntities[entityId]
      }
    })

    previousEntityOrder.forEach((entityId) => {
      if (!currentEntities[entityId]) {
        templatePatch[`entitiesById.${entityId}`] = deleteField()
      }
    })

    if (Object.keys(templatePatch).length > 0) {
      batch.set(templateRef, templatePatch, { merge: true })
      hasWrites = true
    }
  })

  Object.keys(previousTemplates)
    .filter((templateId) => !snapshot.templates.some((template) => template.id === templateId))
    .forEach((templateId) => {
      batch.delete(doc(services.db, 'projects', snapshot.id, 'templates', templateId))
      hasWrites = true
    })

  if (!hasWrites) {
    return
  }

  await batch.commit()
}

export async function uploadExport(
  project: Project,
  floorId: string,
  visibleLayers: LayerType[],
): Promise<ExportRecord> {
  const floor = project.floors.find((item) => item.id === floorId)
  if (!floor) {
    throw new Error('Unable to find floor for export.')
  }

  const exportRecord: ExportRecord = {
    id: `export-${Date.now()}`,
    floorId,
    floorName: floor.name,
    storagePath: '',
    visibleLayers,
    createdAt: new Date().toISOString(),
  }

  const services = getFirebaseServices()
  if (!services) {
    return exportRecord
  }

  await setDoc(
    doc(services.db, 'projects', project.id, 'exports', exportRecord.id),
    exportRecord,
  )

  return exportRecord
}
