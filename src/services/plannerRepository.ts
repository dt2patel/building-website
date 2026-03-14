import {
  collection,
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
import type { ExportRecord, LayerType, PlanEntity, Project } from '../types/planner'

const localStorageKey = 'blueprint-planner:project'
const seedProjectId = createSeedProject().id

export interface ProjectRealtimeState {
  exists: boolean
  hasPendingWrites: boolean
  live: boolean
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
      entities: template.entities.map((entity) => normalizeEntityStyle(entity)),
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

export async function saveProject(project: Project): Promise<void> {
  const snapshot = cloneJson(project)
  saveLocalProject(snapshot)

  const services = getFirebaseServices()
  if (!services) {
    return
  }

  const batch = writeBatch(services.db)
  const projectRef = doc(services.db, 'projects', snapshot.id)
  batch.set(projectRef, {
    schemaVersion: snapshot.schemaVersion,
    id: snapshot.id,
    name: snapshot.name,
    units: snapshot.units,
    gridUnit: snapshot.gridUnit,
    gridSpacing: snapshot.gridSpacing,
    plotBoundary: snapshot.plotBoundary,
    buildingBoundary: snapshot.buildingBoundary,
    fixedStructures: snapshot.fixedStructures,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  })

  snapshot.floors.forEach((floor) => {
    batch.set(doc(services.db, 'projects', snapshot.id, 'floors', floor.id), floor)
  })

  snapshot.templates.forEach((template) => {
    batch.set(doc(services.db, 'projects', snapshot.id, 'templates', template.id), template)
  })

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
