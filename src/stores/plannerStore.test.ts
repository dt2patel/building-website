import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlannerStore } from './plannerStore'
import { createSeedProject } from '../config/seedProject'

vi.mock('../services/firebase', () => ({
  isFirebaseConfigured: () => true,
}))

const repositoryState = vi.hoisted(() => ({
  realtimeState: {
    exists: true,
    hasPendingWrites: false,
    live: true,
  },
}))

vi.mock('../services/plannerRepository', async () => {
  return {
    loadProject: vi.fn(async () => createSeedProject()),
    saveProject: vi.fn(async () => undefined),
    subscribeToProject: vi.fn((_projectId: string, handlers: {
      onProject: (project: ReturnType<typeof createSeedProject>) => void
      onStateChange: (state: typeof repositoryState.realtimeState) => void
      onError: (error: Error) => void
    }) => {
      handlers.onProject(createSeedProject())
      handlers.onStateChange(repositoryState.realtimeState)
      return vi.fn()
    }),
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
    repositoryState.realtimeState = {
      exists: true,
      hasPendingWrites: false,
      live: true,
    }
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('assigns a newly created template to the active floor layer', async () => {
    const store = usePlannerStore()
    await store.initialize()
    const previousTemplateId = store.currentTemplateId

    store.createTemplate()

    const createdTemplate = store.templatesByLayer[store.activeLayerType].at(-1)

    expect(createdTemplate).toBeTruthy()
    expect(createdTemplate?.id).not.toBe(previousTemplateId)
    expect(store.currentTemplateId).toBe(createdTemplate?.id ?? null)
    expect(store.currentTemplate?.id).toBe(createdTemplate?.id)
  })

  it('treats a layer without an assignment as having no current template', async () => {
    const store = usePlannerStore()
    await store.initialize()

    store.setActiveLayer('structural')
    store.assignTemplate('structural', null)

    expect(store.currentTemplateId).toBe(null)
    expect(store.currentTemplate).toBe(null)
  })

  it('creates and assigns a working template before drawing on an unassigned layer', async () => {
    const store = usePlannerStore()
    await store.initialize()

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
    const store = usePlannerStore()
    await store.initialize()

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

  it('clears an in-progress draft when selecting an entity on another layer', async () => {
    const store = usePlannerStore()
    await store.initialize()
    const targetEntity = store.project.templates
      .find((template) => template.id === 'tpl-structural-columns')
      ?.entities[0]

    expect(targetEntity).toBeTruthy()

    store.setToolMode('polygon')
    store.addVertexToDraft({ x: 8, y: 8 })
    store.addVertexToDraft({ x: 12, y: 8 })
    store.selectEntity({ entityId: targetEntity?.id ?? null, layerType: 'structural' })

    expect(store.activeLayerType).toBe('structural')
    expect(store.selectedEntityId).toBe(targetEntity?.id)
    expect(store.draftVertices).toHaveLength(0)
    expect(store.toolMode).toBe('select')
  })

  it('locks editing when the Firestore listener is not live', async () => {
    repositoryState.realtimeState = {
      exists: true,
      hasPendingWrites: false,
      live: false,
    }

    const store = usePlannerStore()
    await store.initialize()
    const previousTemplateCount = store.project.templates.length

    store.createTemplate()

    expect(store.canEdit).toBe(false)
    expect(store.project.templates).toHaveLength(previousTemplateCount)
    expect(store.statusMessage).toContain('Read-only')
  })
})
