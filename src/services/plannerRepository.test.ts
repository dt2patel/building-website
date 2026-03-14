import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSeedProject } from '../config/seedProject'

type FirestoreWrite =
  | {
      type: 'set'
      path: string
      data: unknown
      options?: unknown
    }
  | {
      type: 'delete'
      path: string
    }

const firestoreState = vi.hoisted(() => ({
  remoteProject: null as Record<string, unknown> | null,
  remoteFloors: [] as Record<string, unknown>[],
  remoteTemplates: [] as Record<string, unknown>[],
  batchWrites: [] as FirestoreWrite[],
}))

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  deleteField: vi.fn(() => ({ __type: 'delete-field' })),
  doc: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getDoc: vi.fn(async () => ({
    exists: () => Boolean(firestoreState.remoteProject),
    data: () => firestoreState.remoteProject,
  })),
  getDocs: vi.fn(async (ref: { path: string }) => ({
    docs:
      ref.path.endsWith('/floors')
        ? firestoreState.remoteFloors.map((item) => ({ data: () => item }))
        : firestoreState.remoteTemplates.map((item) => ({ data: () => item })),
  })),
  onSnapshot: vi.fn(() => vi.fn()),
  setDoc: vi.fn(async () => undefined),
  writeBatch: vi.fn(() => ({
    delete: (ref: { path: string }) => {
      firestoreState.batchWrites.push({ type: 'delete', path: ref.path })
    },
    set: (ref: { path: string }, data: unknown, options?: unknown) => {
      firestoreState.batchWrites.push({ type: 'set', path: ref.path, data, options })
    },
    commit: vi.fn(async () => undefined),
  })),
}))

vi.mock('./firebase', () => ({
  getFirebaseServices: () => ({ db: { mock: true } }),
  isFirebaseConfigured: () => true,
}))

function cloneProject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function getWrites(path: string) {
  return firestoreState.batchWrites.filter((entry) => entry.path === path)
}

describe('plannerRepository', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value)
        },
        removeItem: (key: string) => {
          storage.delete(key)
        },
        clear: () => {
          storage.clear()
        },
      },
    })
    window.localStorage.clear()
    firestoreState.remoteProject = null
    firestoreState.remoteFloors = []
    firestoreState.remoteTemplates = []
    firestoreState.batchWrites = []
    vi.resetModules()
  })

  it('prefers the newer remote project over stale local cache', async () => {
    const localProject = createSeedProject()
    localProject.name = 'Local copy'
    localProject.updatedAt = '2026-03-14T10:00:00.000Z'
    window.localStorage.setItem('blueprint-planner:project', JSON.stringify(localProject))

    const remoteProject = createSeedProject()
    remoteProject.name = 'Remote copy'
    remoteProject.updatedAt = '2026-03-14T11:00:00.000Z'
    firestoreState.remoteProject = {
      ...remoteProject,
      floors: undefined,
      templates: undefined,
    }
    firestoreState.remoteFloors = remoteProject.floors as unknown as Record<string, unknown>[]
    firestoreState.remoteTemplates = remoteProject.templates as unknown as Record<string, unknown>[]

    const { loadProject } = await import('./plannerRepository')
    const project = await loadProject()

    expect(project.name).toBe('Remote copy')
    expect(JSON.parse(window.localStorage.getItem('blueprint-planner:project') ?? '{}').name).toBe('Remote copy')
  })

  it('keeps a newer local project when the remote copy is older', async () => {
    const localProject = createSeedProject()
    localProject.name = 'Local newer copy'
    localProject.updatedAt = '2026-03-14T11:30:00.000Z'
    window.localStorage.setItem('blueprint-planner:project', JSON.stringify(localProject))

    const remoteProject = createSeedProject()
    remoteProject.name = 'Remote older copy'
    remoteProject.updatedAt = '2026-03-14T11:00:00.000Z'
    firestoreState.remoteProject = {
      ...remoteProject,
      floors: undefined,
      templates: undefined,
    }
    firestoreState.remoteFloors = remoteProject.floors as unknown as Record<string, unknown>[]
    firestoreState.remoteTemplates = remoteProject.templates as unknown as Record<string, unknown>[]

    const { loadProject } = await import('./plannerRepository')
    const project = await loadProject()

    expect(project.name).toBe('Local newer copy')
  })

  it('loads legacy remote data without schemaVersion and fills defaults', async () => {
    const remoteProject = createSeedProject()
    remoteProject.name = 'Legacy remote copy'
    firestoreState.remoteProject = {
      id: remoteProject.id,
      name: remoteProject.name,
      units: remoteProject.units,
      gridSpacing: remoteProject.gridSpacing,
      plotBoundary: remoteProject.plotBoundary,
      buildingBoundary: remoteProject.buildingBoundary,
      fixedStructures: remoteProject.fixedStructures,
      createdAt: remoteProject.createdAt,
      updatedAt: remoteProject.updatedAt,
    }
    firestoreState.remoteFloors = remoteProject.floors as unknown as Record<string, unknown>[]
    firestoreState.remoteTemplates = remoteProject.templates as unknown as Record<string, unknown>[]

    const { loadProject } = await import('./plannerRepository')
    const project = await loadProject()

    expect(project.name).toBe('Legacy remote copy')
    expect(project.schemaVersion).toBe(createSeedProject().schemaVersion)
    expect(project.gridUnit).toBe(createSeedProject().gridUnit)
  })

  it('rebuilds floors in seed order when Firestore returns them out of order', async () => {
    const remoteProject = createSeedProject()
    const shuffledFloors = [
      remoteProject.floors[2],
      remoteProject.floors[3],
      remoteProject.floors[4],
      remoteProject.floors[5],
      remoteProject.floors[6],
      remoteProject.floors[7],
      remoteProject.floors[0],
      remoteProject.floors[1],
      remoteProject.floors[8],
      remoteProject.floors[9],
    ].filter(Boolean)

    firestoreState.remoteProject = {
      ...remoteProject,
      floors: undefined,
      templates: undefined,
    }
    firestoreState.remoteFloors = shuffledFloors as unknown as Record<string, unknown>[]
    firestoreState.remoteTemplates = remoteProject.templates as unknown as Record<string, unknown>[]

    const { loadProject } = await import('./plannerRepository')
    const project = await loadProject()

    expect(project.floors[0]?.id).toBe('floor-ground')
    expect(project.floors[0]?.name).toBe('Ground Parking')
    expect(project.floors[1]?.id).toBe('floor-podium')
  })

  it('persists schemaVersion and gridUnit to the root project document', async () => {
    const project = createSeedProject()

    const { saveProject } = await import('./plannerRepository')
    await saveProject(null, project)

    const rootWrite = getWrites(`projects/${project.id}`).find((entry) => entry.type === 'set')

    expect(rootWrite).toBeTruthy()
    expect(rootWrite && 'data' in rootWrite ? rootWrite.data : null).toMatchObject({
      schemaVersion: project.schemaVersion,
      gridUnit: project.gridUnit,
      id: project.id,
    })
  })

  it('only patches the root document when only project settings change', async () => {
    const previousProject = createSeedProject()
    const nextProject = cloneProject(previousProject)
    nextProject.gridSpacing = 8
    nextProject.updatedAt = '2026-03-14T12:00:00.000Z'

    const { saveProject } = await import('./plannerRepository')
    await saveProject(previousProject, nextProject)

    expect(firestoreState.batchWrites).toHaveLength(1)
    expect(getWrites(`projects/${nextProject.id}`)).toEqual([
      expect.objectContaining({
        type: 'set',
        data: {
          gridSpacing: 8,
          updatedAt: '2026-03-14T12:00:00.000Z',
        },
      }),
    ])
  })

  it('only patches the changed floor document when a template assignment changes', async () => {
    const previousProject = createSeedProject()
    const nextProject = cloneProject(previousProject)
    nextProject.updatedAt = '2026-03-14T12:00:00.000Z'
    nextProject.floors[0].templateAssignments.structural = 'tpl-structural-next'

    const { saveProject } = await import('./plannerRepository')
    await saveProject(previousProject, nextProject)

    expect(firestoreState.batchWrites).toHaveLength(2)
    expect(getWrites(`projects/${nextProject.id}/floors/${nextProject.floors[0].id}`)).toEqual([
      expect.objectContaining({
        type: 'set',
        data: {
          'templateAssignments.structural': 'tpl-structural-next',
        },
      }),
    ])
  })

  it('patches only the changed entity field inside an existing template document', async () => {
    const previousProject = createSeedProject()
    const nextProject = cloneProject(previousProject)
    nextProject.updatedAt = '2026-03-14T12:00:00.000Z'

    const template = nextProject.templates.find((item) => item.id === 'tpl-structural-columns')
    const entity = template?.entities[0]
    expect(entity).toBeTruthy()

    if (!template || !entity) {
      throw new Error('Expected structural entity fixture')
    }

    entity.label = 'Column 1.2'
    template.updatedAt = '2026-03-14T12:00:00.000Z'

    const { saveProject } = await import('./plannerRepository')
    await saveProject(previousProject, nextProject)

    const templateWrite = getWrites(`projects/${nextProject.id}/templates/${template.id}`)[0]
    expect(templateWrite).toMatchObject({
      type: 'set',
      data: expect.objectContaining({
        updatedAt: '2026-03-14T12:00:00.000Z',
        [`entitiesById.${entity.id}`]: expect.objectContaining({
          id: entity.id,
          label: 'Column 1.2',
        }),
      }),
    })
    expect(templateWrite && 'data' in templateWrite ? templateWrite.data : {}).not.toHaveProperty('entityOrder')
    expect(templateWrite && 'data' in templateWrite ? templateWrite.data : {}).not.toHaveProperty('entities')
  })

  it('patches entity deletion with a field delete marker and a new entity order', async () => {
    const previousProject = createSeedProject()
    const nextProject = cloneProject(previousProject)
    nextProject.updatedAt = '2026-03-14T12:00:00.000Z'

    const template = nextProject.templates.find((item) => item.id === 'tpl-structural-columns')
    expect(template?.entities.length).toBeGreaterThan(0)

    if (!template) {
      throw new Error('Expected structural template fixture')
    }

    const removedEntityId = template.entities[0].id
    template.entities = template.entities.slice(1)
    template.updatedAt = '2026-03-14T12:00:00.000Z'

    const { saveProject } = await import('./plannerRepository')
    await saveProject(previousProject, nextProject)

    const templateWrite = getWrites(`projects/${nextProject.id}/templates/${template.id}`)[0]
    expect(templateWrite).toMatchObject({
      type: 'set',
      data: expect.objectContaining({
        updatedAt: '2026-03-14T12:00:00.000Z',
        entityOrder: template.entities.map((entity) => entity.id),
        [`entitiesById.${removedEntityId}`]: { __type: 'delete-field' },
      }),
    })
  })
})
