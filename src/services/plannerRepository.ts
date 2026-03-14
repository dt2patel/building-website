import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { createSeedProject } from '../config/seedProject'
import { cloneJson } from '../lib/geometry'
import { getFirebaseServices, isFirebaseConfigured } from './firebase'
import type { ExportRecord, Project } from '../types/planner'

const localStorageKey = 'blueprint-planner:project'

function getLocalProject(): Project | null {
  const rawValue = window.localStorage.getItem(localStorageKey)
  return rawValue ? (JSON.parse(rawValue) as Project) : null
}

function saveLocalProject(project: Project) {
  window.localStorage.setItem(localStorageKey, JSON.stringify(project))
}

export async function loadProject(): Promise<Project> {
  const localProject = getLocalProject()
  if (localProject) {
    return localProject
  }

  if (isFirebaseConfigured()) {
    const services = getFirebaseServices()
    if (services) {
      const projectDoc = await getDoc(doc(services.db, 'projects', 'eklavya-blueprint-lab'))
      if (projectDoc.exists()) {
        const floorsSnapshot = await getDocs(
          collection(services.db, 'projects', 'eklavya-blueprint-lab', 'floors'),
        )
        const templatesSnapshot = await getDocs(
          collection(services.db, 'projects', 'eklavya-blueprint-lab', 'templates'),
        )

        const project = {
          ...(projectDoc.data() as Project),
          floors: floorsSnapshot.docs.map((item) => item.data()) as Project['floors'],
          templates: templatesSnapshot.docs.map((item) => item.data()) as Project['templates'],
        }

        saveLocalProject(project)
        return project
      }
    }
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
    id: snapshot.id,
    name: snapshot.name,
    units: snapshot.units,
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

export async function uploadExport(project: Project, floorId: string, blob: Blob): Promise<ExportRecord> {
  const floor = project.floors.find((item) => item.id === floorId)
  if (!floor) {
    throw new Error('Unable to find floor for export.')
  }

  const exportRecord: ExportRecord = {
    id: `export-${Date.now()}`,
    floorId,
    floorName: floor.name,
    storagePath: '',
    visibleLayers: [],
    createdAt: new Date().toISOString(),
  }

  const services = getFirebaseServices()
  if (!services) {
    return exportRecord
  }

  const storagePath = `exports/${project.id}/${floor.id}/${exportRecord.id}.pdf`
  const storageRef = ref(services.storage, storagePath)

  await uploadBytes(storageRef, blob, { contentType: 'application/pdf' })
  const downloadUrl = await getDownloadURL(storageRef)

  const recordWithPath: ExportRecord = {
    ...exportRecord,
    storagePath,
    downloadUrl,
  }

  await setDoc(
    doc(services.db, 'projects', project.id, 'exports', recordWithPath.id),
    recordWithPath,
  )

  return recordWithPath
}
