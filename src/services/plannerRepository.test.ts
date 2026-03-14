import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSeedProject } from '../config/seedProject'

type FirestoreWrite =
  | {
      type: 'set'
      path: string
      data: Record<string, unknown>
      options?: { merge?: boolean }
    }
  | {
      type: 'delete'
      path: string
    }

const firestoreState = vi.hoisted(() => ({
  docs: {} as Record<string, Record<string, unknown>>,
  batchWrites: [] as FirestoreWrite[],
  authUsers: {} as Record<string, { uid: string; email: string; password: string }>,
  currentUser: null as null | { uid: string; email: string },
}))

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function setAtPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') {
      cursor[part] = {}
    }
    cursor = cursor[part] as Record<string, unknown>
  })
  cursor[parts.at(-1) ?? path] = value
}

function deleteAtPath(target: Record<string, unknown>, path: string) {
  const parts = path.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') {
      return
    }
    cursor = cursor[part] as Record<string, unknown>
  })
  delete cursor[parts.at(-1) ?? path]
}

function applySet(path: string, data: Record<string, unknown>, options?: { merge?: boolean }) {
  if (!options?.merge) {
    firestoreState.docs[path] = clone(data)
    return
  }

  const nextValue = clone(firestoreState.docs[path] ?? {})
  Object.entries(data).forEach(([key, value]) => {
    if (
      value &&
      typeof value === 'object' &&
      '__type' in value &&
      (value as { __type: string }).__type === 'delete-field'
    ) {
      deleteAtPath(nextValue, key)
      return
    }

    if (key.includes('.')) {
      setAtPath(nextValue, key, clone(value))
      return
    }

    nextValue[key] = clone(value)
  })
  firestoreState.docs[path] = nextValue
}

function listDocs(path: string) {
  return Object.entries(firestoreState.docs)
    .filter(([docPath]) => docPath.startsWith(`${path}/`) && docPath.slice(path.length + 1).split('/').length === 1)
    .map(([docPath, data]) => ({ id: docPath.split('/').at(-1) ?? '', data: () => clone(data) }))
}

function getWrites(path: string) {
  return firestoreState.batchWrites.filter((entry) => entry.path === path)
}

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  deleteDoc: vi.fn(async (ref: { path: string }) => {
    delete firestoreState.docs[ref.path]
  }),
  deleteField: vi.fn(() => ({ __type: 'delete-field' })),
  doc: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getDoc: vi.fn(async (ref: { path: string }) => ({
    exists: () => Boolean(firestoreState.docs[ref.path]),
    data: () => clone(firestoreState.docs[ref.path]),
    metadata: { hasPendingWrites: false, fromCache: false },
  })),
  getDocs: vi.fn(async (ref: { path: string }) => ({
    docs: listDocs(ref.path),
    metadata: { hasPendingWrites: false, fromCache: false },
  })),
  onSnapshot: vi.fn(() => vi.fn()),
  query: vi.fn((ref: { path: string }) => ref),
  setDoc: vi.fn(async (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
    applySet(ref.path, data, options)
  }),
  writeBatch: vi.fn(() => {
    const writes: FirestoreWrite[] = []
    return {
      delete: (ref: { path: string }) => {
        writes.push({ type: 'delete', path: ref.path })
      },
      set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
        writes.push({ type: 'set', path: ref.path, data, options })
      },
      commit: vi.fn(async () => {
        firestoreState.batchWrites.push(...writes)
        writes.forEach((write) => {
          if (write.type === 'delete') {
            delete firestoreState.docs[write.path]
            return
          }

          applySet(write.path, write.data, write.options)
        })
      }),
    }
  }),
}))

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(async (_auth: unknown, email: string, password: string) => {
    const uid = `uid-${Object.keys(firestoreState.authUsers).length + 1}`
    firestoreState.authUsers[email] = { uid, email, password }
    return { user: { uid, email } }
  }),
  onAuthStateChanged: vi.fn((_auth: unknown, handler: (user: { uid: string; email: string } | null) => void) => {
    handler(firestoreState.currentUser)
    return vi.fn()
  }),
  signInWithEmailAndPassword: vi.fn(async (_auth: unknown, email: string, password: string) => {
    const user = firestoreState.authUsers[email]
    if (!user || user.password !== password) {
      throw new Error('Invalid credentials')
    }
    firestoreState.currentUser = { uid: user.uid, email: user.email }
    return { user: clone(firestoreState.currentUser) }
  }),
  signOut: vi.fn(async () => {
    firestoreState.currentUser = null
  }),
}))

vi.mock('./firebase', () => ({
  createSecondaryAuthServices: async () => ({
    auth: { mock: true },
    cleanup: async () => undefined,
  }),
  getFirebaseServices: () => ({ db: { mock: true }, auth: { mock: true } }),
  isFirebaseConfigured: () => true,
}))

describe('plannerRepository', () => {
  beforeEach(() => {
    firestoreState.docs = {}
    firestoreState.batchWrites = []
    firestoreState.authUsers = {}
    firestoreState.currentUser = null
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
    vi.resetModules()
  })

  it('createProject writes a project container, default save, and mirrored membership docs', async () => {
    firestoreState.docs['users/user-1'] = {
      uid: 'user-1',
      username: 'aditya',
      normalizedUsername: 'aditya',
      role: 'admin',
      archived: false,
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
    }

    const { createProject } = await import('./plannerRepository')
    const created = await createProject({
      name: 'Tower A',
      creatorUid: 'user-1',
    })

    expect(firestoreState.docs[`projects/${created.meta.id}`]).toMatchObject({
      id: created.meta.id,
      name: 'Tower A',
      defaultSaveId: 'save-default',
    })
    expect(firestoreState.docs[`projects/${created.meta.id}/saves/save-default`]).toMatchObject({
      id: 'save-default',
      name: 'Default Save',
      isDefault: true,
      archived: false,
    })
    expect(firestoreState.docs[`projects/${created.meta.id}/members/user-1`]).toMatchObject({
      username: 'aditya',
      canEdit: true,
    })
    expect(firestoreState.docs[`users/user-1/projects/${created.meta.id}`]).toMatchObject({
      projectId: created.meta.id,
      projectName: 'Tower A',
      canEdit: true,
    })
  })

  it('saveActiveProjectState rewrites the full save snapshot and removes deleted templates', async () => {
    const previousProject = createSeedProject()
    previousProject.id = 'project-1'
    previousProject.name = 'Planner Test'
    firestoreState.docs['projects/project-1/saves/save-default'] = {
      id: 'save-default',
      name: 'Default Save',
      archived: false,
      isDefault: true,
      parentSaveId: null,
      sourceProjectId: null,
      createdBy: 'user-1',
      createdAt: previousProject.createdAt,
      updatedAt: previousProject.updatedAt,
      schemaVersion: previousProject.schemaVersion,
      units: previousProject.units,
      gridUnit: previousProject.gridUnit,
      gridSpacing: previousProject.gridSpacing,
      plotBoundary: previousProject.plotBoundary,
      buildingBoundary: previousProject.buildingBoundary,
      fixedStructures: previousProject.fixedStructures,
    }
    previousProject.floors.forEach((floor) => {
      firestoreState.docs[`projects/project-1/saves/save-default/floors/${floor.id}`] = clone(floor) as unknown as Record<string, unknown>
    })
    previousProject.templates.forEach((template) => {
      firestoreState.docs[`projects/project-1/saves/save-default/templates/${template.id}`] = clone(template) as unknown as Record<string, unknown>
    })
    const nextProject = clone(previousProject)
    nextProject.gridSpacing = 8
    nextProject.updatedAt = '2026-03-14T12:00:00.000Z'
    nextProject.floors[0].templateAssignments.structural = 'tpl-structural-next'
    const plumbingTemplate = nextProject.templates.find((template) => template.id === 'tpl-plumbing-master')
    plumbingTemplate?.entities.forEach((entity) => {
      entity.vertices = entity.vertices.map((vertex) => ({
        x: vertex.x + 1,
        y: vertex.y + 2,
      }))
    })
    nextProject.templates = nextProject.templates.filter((template) => template.id !== 'tpl-custom-blank')

    const { saveActiveProjectState } = await import('./plannerRepository')
    await saveActiveProjectState(previousProject, nextProject, {
      projectId: 'project-1',
      saveId: 'save-default',
      userId: 'user-1',
    })

    expect(firestoreState.docs['projects/project-1/saves/save-default']).toMatchObject({
      id: 'save-default',
      name: 'Default Save',
      gridSpacing: 8,
      updatedAt: '2026-03-14T12:00:00.000Z',
    })
    expect(firestoreState.docs['projects/project-1/saves/save-default/floors/floor-ground']).toMatchObject({
      templateAssignments: expect.objectContaining({
        structural: 'tpl-structural-next',
      }),
    })
    expect(firestoreState.docs['projects/project-1/saves/save-default/templates/tpl-plumbing-master']).toMatchObject({
      entitiesById: expect.objectContaining({
        'plumb-stack': expect.objectContaining({
          vertices: expect.arrayContaining([
            expect.objectContaining({ x: 14.8, y: 20 }),
          ]),
        }),
      }),
    })
    expect(firestoreState.docs['projects/project-1/saves/save-default/templates/tpl-custom-blank']).toBeUndefined()
  })

  it('loadSave rebuilds the active project from project meta and save subcollections', async () => {
    const project = createSeedProject()
    project.id = 'project-1'
    project.name = 'Planner Test'

    firestoreState.docs['projects/project-1'] = {
      id: 'project-1',
      name: 'Planner Test',
      archived: false,
      createdBy: 'user-1',
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      defaultSaveId: 'save-default',
      lastOpenedSaveId: 'save-default',
    }
    firestoreState.docs['projects/project-1/saves/save-default'] = {
      id: 'save-default',
      name: 'Default Save',
      archived: false,
      isDefault: true,
      parentSaveId: null,
      sourceProjectId: null,
      createdBy: 'user-1',
      schemaVersion: project.schemaVersion,
      units: project.units,
      gridUnit: project.gridUnit,
      gridSpacing: project.gridSpacing,
      plotBoundary: project.plotBoundary,
      buildingBoundary: project.buildingBoundary,
      fixedStructures: project.fixedStructures,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }
    project.floors.forEach((floor) => {
      firestoreState.docs[`projects/project-1/saves/save-default/floors/${floor.id}`] = clone(floor) as unknown as Record<string, unknown>
    })
    project.templates.forEach((template) => {
      firestoreState.docs[`projects/project-1/saves/save-default/templates/${template.id}`] = {
        ...clone(template),
        entityOrder: template.entities.map((entity) => entity.id),
        entitiesById: Object.fromEntries(template.entities.map((entity) => [entity.id, entity])),
      }
    })

    const { loadSave } = await import('./plannerRepository')
    const loaded = await loadSave('project-1', 'save-default', 'user-1')

    expect(loaded.id).toBe('project-1')
    expect(loaded.name).toBe('Planner Test')
    expect(loaded.floors[0]?.id).toBe('floor-ground')
    expect(loaded.templates.find((template) => template.id === 'tpl-structural-columns')?.entities[0]?.id).toBe('col-1-1')
  })

  it('archiveProject mirrors the archive state onto every user membership record', async () => {
    firestoreState.docs['projects/project-1'] = {
      id: 'project-1',
      name: 'Planner Test',
      archived: false,
      createdBy: 'user-1',
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
      defaultSaveId: 'save-default',
    }
    firestoreState.docs['projects/project-1/members/user-1'] = {
      uid: 'user-1',
      username: 'aditya',
      canEdit: true,
      addedAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
    }
    firestoreState.docs['users/user-1/projects/project-1'] = {
      projectId: 'project-1',
      projectName: 'Planner Test',
      canEdit: true,
      archived: false,
      addedAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
    }

    const { archiveProject } = await import('./plannerRepository')
    await archiveProject('project-1', true)

    expect(firestoreState.docs['projects/project-1']).toMatchObject({
      archived: true,
    })
    expect(firestoreState.docs['users/user-1/projects/project-1']).toMatchObject({
      archived: true,
    })
  })

  it('updateUserRole changes an existing user role', async () => {
    firestoreState.docs['users/user-1'] = {
      uid: 'user-1',
      username: 'anil',
      normalizedUsername: 'anil',
      role: 'user',
      archived: false,
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
    }

    const { updateUserRole } = await import('./plannerRepository')
    await updateUserRole('user-1', 'admin')

    expect(firestoreState.docs['users/user-1']).toMatchObject({
      role: 'admin',
    })
  })

  it('setUserBlocked updates block metadata and can clear it again', async () => {
    firestoreState.docs['users/user-1'] = {
      uid: 'user-1',
      username: 'anil',
      normalizedUsername: 'anil',
      role: 'user',
      archived: false,
      blocked: false,
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
    }

    const { setUserBlocked } = await import('./plannerRepository')
    await setUserBlocked('user-1', true, 'admin-1')

    expect(firestoreState.docs['users/user-1']).toMatchObject({
      blocked: true,
      blockedBy: 'admin-1',
    })

    await setUserBlocked('user-1', false, 'admin-1')

    expect(firestoreState.docs['users/user-1']).toMatchObject({
      blocked: false,
    })
    expect(firestoreState.docs['users/user-1']).not.toHaveProperty('blockedAt')
    expect(firestoreState.docs['users/user-1']).not.toHaveProperty('blockedBy')
  })

  it('linkUserToProject and unlinkUserFromProject mirror membership docs', async () => {
    firestoreState.docs['projects/project-1'] = {
      id: 'project-1',
      name: 'Planner Test',
      archived: false,
      createdBy: 'admin-1',
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
      defaultSaveId: 'save-default',
    }
    firestoreState.docs['users/user-1'] = {
      uid: 'user-1',
      username: 'anil',
      normalizedUsername: 'anil',
      role: 'user',
      archived: false,
      blocked: false,
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
    }

    const { linkUserToProject, unlinkUserFromProject } = await import('./plannerRepository')
    await linkUserToProject('user-1', 'project-1', true)

    expect(firestoreState.docs['projects/project-1/members/user-1']).toMatchObject({
      canEdit: true,
      username: 'anil',
    })
    expect(firestoreState.docs['users/user-1/projects/project-1']).toMatchObject({
      canEdit: true,
      projectName: 'Planner Test',
    })

    await unlinkUserFromProject('user-1', 'project-1')

    expect(firestoreState.docs['projects/project-1/members/user-1']).toBeUndefined()
    expect(firestoreState.docs['users/user-1/projects/project-1']).toBeUndefined()
  })

  it('migrateLegacyProjectForAdmin creates the bundled Eklavya project when no legacy document exists', async () => {
    firestoreState.docs['users/admin-1'] = {
      uid: 'admin-1',
      username: 'aditya',
      normalizedUsername: 'aditya',
      role: 'admin',
      archived: false,
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
    }
    firestoreState.docs['users/user-2'] = {
      uid: 'user-2',
      username: 'anil',
      normalizedUsername: 'anil',
      role: 'user',
      archived: false,
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
    }
    firestoreState.docs['usernames/aditya'] = { uid: 'admin-1' }
    firestoreState.docs['usernames/anil'] = { uid: 'user-2' }

    const { migrateLegacyProjectForAdmin } = await import('./plannerRepository')
    const migrated = await migrateLegacyProjectForAdmin('admin-1')

    expect(migrated).toMatchObject({
      id: 'eklavya-blueprint-lab',
      name: 'Eklavya',
      defaultSaveId: 'save-default',
    })
    expect(firestoreState.docs['projects/eklavya-blueprint-lab']).toMatchObject({
      id: 'eklavya-blueprint-lab',
      name: 'Eklavya',
    })
    expect(firestoreState.docs['projects/eklavya-blueprint-lab/saves/save-default']).toMatchObject({
      id: 'save-default',
      isDefault: true,
    })
    expect(firestoreState.docs['projects/eklavya-blueprint-lab/members/admin-1']).toMatchObject({
      canEdit: true,
    })
    expect(firestoreState.docs['projects/eklavya-blueprint-lab/members/user-2']).toMatchObject({
      canEdit: false,
    })
  })
})
