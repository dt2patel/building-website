import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from './authStore'
import { usePlannerStore } from './plannerStore'
import { createSeedProject } from '../config/seedProject'
import type { Project } from '../types/planner'

vi.mock('../services/firebase', () => ({
  isFirebaseConfigured: () => true,
}))

const exportMocks = vi.hoisted(() => ({
  downloadBlob: vi.fn(),
  exportFloorPdf: vi.fn(async () => new Blob()),
  exportProjectJsonBlob: vi.fn((project: Project) => new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })),
  projectJsonFilename: vi.fn((project: Project, saveId: string) => `${project.id}-${saveId}.json`),
}))

vi.mock('../lib/export', () => exportMocks)

function createMockProject() {
  const project = createSeedProject()
  project.id = 'project-1'
  project.name = 'Planner Test'
  return project
}

function cloneProject<T>(project: T): T {
  return JSON.parse(JSON.stringify(project)) as T
}

const repositoryState = vi.hoisted(() => ({
  remoteProject: null as Project | null,
  localProject: null as Project | null,
}))

vi.mock('../services/plannerRepository', async () => {
  return {
    archiveSave: vi.fn(async () => undefined),
    createSaveFromSource: vi.fn(async () => 'save-fork-1'),
    loadProjectMeta: vi.fn(async () => ({
      id: 'project-1',
      name: 'Planner Test',
      archived: false,
      createdBy: 'user-1',
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
      defaultSaveId: 'save-default',
      lastOpenedSaveId: 'save-default',
    })),
    loadSave: vi.fn(async () => cloneProject(repositoryState.localProject ?? repositoryState.remoteProject ?? createMockProject())),
    loadSaves: vi.fn(async (_projectId: string, options?: { archived?: boolean }) =>
      options?.archived
        ? []
        : [
            {
              id: 'save-default',
              name: 'Default Save',
              archived: false,
              isDefault: true,
              parentSaveId: null,
              sourceProjectId: null,
              createdBy: 'user-1',
              createdAt: '2026-03-14T00:00:00.000Z',
              updatedAt: '2026-03-14T00:00:00.000Z',
            },
          ],
    ),
    saveActiveProjectState: vi.fn(async (_previousProject, project) => {
      repositoryState.remoteProject = cloneProject(project)
      repositoryState.localProject = cloneProject(project)
    }),
    cacheProjectStateLocally: vi.fn((project) => {
      repositoryState.localProject = cloneProject(project)
    }),
    setLastOpenedSave: vi.fn(async () => undefined),
    uploadExport: vi.fn(async () => ({
      id: 'export-1',
      floorId: 'floor-ground',
      floorName: 'Ground Parking',
      storagePath: '',
      visibleLayers: [],
      createdAt: new Date().toISOString(),
    })),
  }
})

describe('plannerStore workflow coverage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-14T00:00:00.000Z'))
    repositoryState.remoteProject = createMockProject()
    repositoryState.localProject = null
    exportMocks.downloadBlob.mockClear()
    exportMocks.exportFloorPdf.mockClear()
    exportMocks.exportProjectJsonBlob.mockClear()
    exportMocks.projectJsonFilename.mockClear()

    const auth = useAuthStore()
    auth.profile = {
      uid: 'user-1',
      username: 'aditya',
      normalizedUsername: 'aditya',
      role: 'admin',
      archived: false,
      blocked: false,
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
    }
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function initializeStore() {
    const store = usePlannerStore()
    await store.initialize({
      projectId: 'project-1',
      saveId: 'save-default',
      canEdit: true,
    })
    return store
  }

  it('assigns a newly created template to the active floor layer', async () => {
    const store = await initializeStore()
    const previousTemplateId = store.currentTemplateId

    store.createTemplate()

    const createdTemplate = store.templatesByLayer[store.activeLayerType].at(-1)

    expect(createdTemplate).toBeTruthy()
    expect(createdTemplate?.id).not.toBe(previousTemplateId)
    expect(store.currentTemplateId).toBe(createdTemplate?.id ?? null)
    expect(store.currentTemplate?.id).toBe(createdTemplate?.id)
  })

  it('treats a layer without an assignment as having no current template', async () => {
    const store = await initializeStore()

    store.setActiveLayer('structural')
    store.assignTemplate('structural', null)

    expect(store.currentTemplateId).toBe(null)
    expect(store.currentTemplate).toBe(null)
  })

  it('creates and assigns a working template before drawing on an unassigned layer', async () => {
    const store = await initializeStore()

    store.setActiveLayer('structural')
    store.assignTemplate('structural', null)
    store.setToolMode('point')
    store.addVertexToDraft({ x: 10, y: 10 })

    expect(store.currentTemplateId).toMatch(/^structural-blank-/)
    expect(store.currentTemplate?.entities).toHaveLength(1)
    expect(store.currentTemplate?.entities[0]?.geometryType).toBe('point')
    expect(store.selectedEntityId).toBe(store.currentTemplate?.entities[0]?.id)
    expect(store.toolMode).toBe('select')
  })

  it('returns to select mode after committing a polygon draft', async () => {
    const store = await initializeStore()

    store.setToolMode('polygon')
    store.addVertexToDraft({ x: 8, y: 8 })
    store.addVertexToDraft({ x: 12, y: 8 })
    store.addVertexToDraft({ x: 12, y: 12 })
    store.commitDraft()

    const createdEntity = store.currentTemplate?.entities.at(-1)

    expect(createdEntity?.geometryType).toBe('polygon')
    expect(store.draftVertices).toHaveLength(0)
    expect(store.selectedEntityId).toBe(createdEntity?.id)
    expect(store.toolMode).toBe('select')
  })

  it('translates a selected polyline by the provided delta', async () => {
    const store = await initializeStore()
    const entity = store.project?.templates
      .find((template) => template.id === 'tpl-plumbing-master')
      ?.entities.find((item) => item.id === 'plumb-stack')

    expect(entity).toBeTruthy()

    store.translateEntity('plumb-stack', { x: 2, y: -1 })

    const movedEntity = store.project?.templates
      .find((template) => template.id === 'tpl-plumbing-master')
      ?.entities.find((item) => item.id === 'plumb-stack')

    expect(movedEntity?.vertices[0]).toEqual({ x: 15.8, y: 17 })
  })

  it('keeps editing enabled for a loaded Firebase-backed project', async () => {
    const store = await initializeStore()
    store.createTemplate()

    expect(store.canEdit).toBe(true)
    expect(store.project?.templates.some((template) => template.id.startsWith('perimeter-concept-'))).toBe(true)
  })

  it('persists translated entities through the save cycle', async () => {
    const store = await initializeStore()

    store.selectEntity({ entityId: 'plumb-stack', layerType: 'plumbing' })
    store.translateEntity('plumb-stack', { x: 2, y: -1 })
    vi.runAllTimers()
    await Promise.resolve()

    expect(repositoryState.remoteProject?.templates
      .find((template) => template.id === 'tpl-plumbing-master')
      ?.entities.find((entity) => entity.id === 'plumb-stack')
      ?.vertices[0]).toEqual({ x: 15.8, y: 17 })
  })

  it('restores a moved point after refresh even before the debounced save runs', async () => {
    const store = await initializeStore()

    vi.setSystemTime(new Date('2026-03-14T00:00:01.000Z'))
    store.selectEntity({ entityId: 'panel-main', layerType: 'electrical' })
    store.updateSelectedEntityVertex(0, 'x', 9.4, store.project?.gridUnit ?? 'm')
    store.cleanup()

    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.profile = {
      uid: 'user-1',
      username: 'aditya',
      normalizedUsername: 'aditya',
      role: 'admin',
      archived: false,
      blocked: false,
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
    }

    const refreshedStore = await initializeStore()
    const movedPoint = refreshedStore.project?.templates
      .find((template) => template.id === 'tpl-electrical-master')
      ?.entities.find((entity) => entity.id === 'panel-main')

    expect(movedPoint?.vertices[0]?.x).toBe(9.4)
  })

  it('downloads the current project as JSON for seed data export', async () => {
    const store = await initializeStore()

    store.exportProjectJson()

    expect(exportMocks.exportProjectJsonBlob).toHaveBeenCalledWith(store.project)
    expect(exportMocks.projectJsonFilename).toHaveBeenCalledWith(store.project, 'save-default')
    expect(exportMocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'project-1-save-default.json')
    expect(store.statusMessage).toBe('Project JSON downloaded locally')
  })
})
