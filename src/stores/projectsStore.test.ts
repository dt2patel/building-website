import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from './authStore'
import { useProjectsStore } from './projectsStore'
import type { ProjectMember, ProjectMeta, UserProfile } from '../types/planner'

const activeProjectsQueue = vi.hoisted(() => [] as Array<Array<ProjectMeta & { canEdit: boolean }>>)
const archivedProjectsQueue = vi.hoisted(() => [] as Array<Array<ProjectMeta & { canEdit: boolean }>>)

vi.mock('../services/plannerRepository', () => ({
  archiveProject: vi.fn(async () => undefined),
  cloneProject: vi.fn(async () => ({
    meta: {
      id: 'project-clone',
      name: 'Cloned Project',
      archived: false,
      createdBy: 'user-1',
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
      defaultSaveId: 'save-default',
      lastOpenedSaveId: 'save-default',
    },
    saveId: 'save-default',
  })),
  createProject: vi.fn(async () => ({
    meta: {
      id: 'project-new',
      name: 'New Project',
      archived: false,
      createdBy: 'user-1',
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
      defaultSaveId: 'save-default',
      lastOpenedSaveId: 'save-default',
    },
    saveId: 'save-default',
  })),
  createUser: vi.fn(async () => undefined),
  listUsers: vi.fn(async () => []),
  loadProjectMembers: vi.fn(async () => []),
  loadProjectsForUser: vi.fn(async (_uid: string, options?: { archived?: boolean }) => {
    const queue = options?.archived ? archivedProjectsQueue : activeProjectsQueue
    return queue.shift() ?? []
  }),
  migrateLegacyProjectForAdmin: vi.fn(async () => undefined),
  removeProjectMembership: vi.fn(async () => undefined),
  updateProjectMembership: vi.fn(async () => undefined),
  updateUserRole: vi.fn(async () => undefined),
}))

function createProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'user-1',
    username: 'aditya',
    normalizedUsername: 'aditya',
    role: 'admin',
    archived: false,
    blocked: false,
    createdAt: '2026-03-14T00:00:00.000Z',
    updatedAt: '2026-03-14T00:00:00.000Z',
    ...overrides,
  }
}

function createProjectMeta(overrides: Partial<ProjectMeta & { canEdit: boolean }> = {}): ProjectMeta & { canEdit: boolean } {
  return {
    id: 'project-1',
    name: 'Planner Test',
    archived: false,
    createdBy: 'user-1',
    createdAt: '2026-03-14T00:00:00.000Z',
    updatedAt: '2026-03-14T00:00:00.000Z',
    defaultSaveId: 'save-default',
    lastOpenedSaveId: 'save-default',
    canEdit: true,
    ...overrides,
  }
}

describe('projectsStore refresh behavior', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    activeProjectsQueue.length = 0
    archivedProjectsQueue.length = 0

    const auth = useAuthStore()
    auth.profile = createProfile()
    auth.initialized = true
  })

  it('refreshProjects updates stale metadata without clearing unrelated store state', async () => {
    activeProjectsQueue.push([createProjectMeta()])
    archivedProjectsQueue.push([])

    const store = useProjectsStore()
    await store.initialize()

    const member: ProjectMember = {
      uid: 'user-2',
      username: 'anil',
      canEdit: false,
      addedAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
    }
    store.membersByProject = {
      'project-1': [member],
    }
    store.users = [createProfile({ uid: 'user-2', username: 'anil', normalizedUsername: 'anil', role: 'user' })]

    activeProjectsQueue.push([
      createProjectMeta({
        updatedAt: '2026-03-14T12:00:00.000Z',
        lastOpenedSaveId: 'save-fork-1',
      }),
    ])
    archivedProjectsQueue.push([])

    await store.refreshProjects()

    expect(store.projects[0]?.updatedAt).toBe('2026-03-14T12:00:00.000Z')
    expect(store.projects[0]?.lastOpenedSaveId).toBe('save-fork-1')
    expect(store.membersByProject['project-1']).toEqual([member])
    expect(store.users).toHaveLength(1)
  })

  it('initialize is one-time per user and refreshProjects drives subsequent reloads', async () => {
    activeProjectsQueue.push([createProjectMeta()])
    archivedProjectsQueue.push([])

    const store = useProjectsStore()
    await store.initialize()

    expect(store.projects[0]?.updatedAt).toBe('2026-03-14T00:00:00.000Z')

    await store.initialize()

    expect(store.projects[0]?.updatedAt).toBe('2026-03-14T00:00:00.000Z')

    activeProjectsQueue.push([
      createProjectMeta({
        updatedAt: '2026-03-14T18:30:00.000Z',
      }),
    ])
    archivedProjectsQueue.push([])

    await store.refreshProjects()

    expect(store.projects[0]?.updatedAt).toBe('2026-03-14T18:30:00.000Z')
  })
})
