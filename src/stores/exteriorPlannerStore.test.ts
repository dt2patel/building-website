import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from './authStore'
import { useExteriorPlannerStore } from './exteriorPlannerStore'
import { createSeedProject } from '../config/seedProject'
import type { Project } from '../types/planner'

vi.mock('../services/firebase', () => ({
  isFirebaseConfigured: () => true,
}))

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

const repositoryMocks = vi.hoisted(() => ({
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
  loadSaves: vi.fn(async () => [
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
  ]),
  saveActiveProjectState: vi.fn(async (_previousProject, project) => {
    repositoryState.remoteProject = cloneProject(project)
    repositoryState.localProject = cloneProject(project)
  }),
  cacheProjectStateLocally: vi.fn((project) => {
    repositoryState.localProject = cloneProject(project)
  }),
  setLastOpenedSave: vi.fn(async () => undefined),
}))

vi.mock('../services/plannerRepository', async () => {
  return repositoryMocks
})

describe('exteriorPlannerStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-14T00:00:00.000Z'))
    repositoryState.remoteProject = createMockProject()
    repositoryState.localProject = null
    Object.values(repositoryMocks).forEach((mock) => mock.mockClear())

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
    const store = useExteriorPlannerStore()
    await store.initialize({
      projectId: 'project-1',
      saveId: 'save-default',
      canEdit: true,
    })
    return store
  }

  it('filters templates to the selected side and exact floor height', async () => {
    const store = await initializeStore()

    store.selectSide('east')

    expect(store.filteredTemplates.every((template) => template.side === 'east')).toBe(true)
    expect(store.filteredTemplates.every((template) => template.heightMeters === store.selectedFloor?.heightMeters)).toBe(true)
  })

  it('clears all explicit side assignments when floor height changes', async () => {
    const store = await initializeStore()
    store.assignTemplate('ext-east-parking')
    store.selectSide('west')
    store.assignTemplate('ext-west-parking')
    store.selectSide('east')

    store.updateFloorHeight(3.2, 'm')

    expect(store.selectedFloor?.exterior).toEqual({
      east: null,
      west: null,
      north: null,
      south: null,
    })
  })

  it('rejects assigning a mismatched side template', async () => {
    const store = await initializeStore()

    store.selectSide('east')
    store.assignTemplate('ext-west-parking')

    expect(store.selectedFloor?.exterior.east).toBe(null)
  })

  it('creates and assigns a working exterior template before drawing', async () => {
    const store = await initializeStore()

    store.setToolMode('point')
    store.addVertexToDraft({ x: 2, y: 1 })

    expect(store.currentTemplateId).toMatch(/^ext-east-blank-/)
    expect(store.currentTemplate?.entities).toHaveLength(1)
  })

  it('flushes pending changes during cleanup so quick navigation still saves', async () => {
    const store = await initializeStore()

    store.setToolMode('point')
    store.addVertexToDraft({ x: 2, y: 1 })

    expect(repositoryMocks.saveActiveProjectState).not.toHaveBeenCalled()

    store.cleanup()

    expect(repositoryMocks.saveActiveProjectState).toHaveBeenCalledTimes(1)
    expect(repositoryState.remoteProject?.exteriorTemplates.some((template) => template.entities.length > 0)).toBe(true)
  })
})
