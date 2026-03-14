import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { UserProfile } from '../types/planner'

const repositoryState = vi.hoisted(() => ({
  authUser: null as null | { uid: string },
  signInResult: null as UserProfile | null,
  profileHandler: null as null | ((profile: UserProfile | null) => void),
}))

const routerReplace = vi.hoisted(() => vi.fn(async () => undefined))
const signOutUserMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('../services/firebase', () => ({
  isFirebaseConfigured: () => true,
}))

vi.mock('../router', () => ({
  default: {
    replace: routerReplace,
  },
}))

vi.mock('../services/plannerRepository', () => ({
  ensureDefaultUsers: vi.fn(async () => undefined),
  loadCurrentUserProfile: vi.fn(async (uid: string) =>
    repositoryState.authUser?.uid === uid ? repositoryState.signInResult : null,
  ),
  signIn: vi.fn(async () => repositoryState.signInResult),
  signOutUser: signOutUserMock,
  subscribeToAuthState: vi.fn((handler: (user: { uid: string } | null) => void) => {
    handler(repositoryState.authUser)
    return vi.fn()
  }),
  subscribeToUserProfile: vi.fn((_uid: string, handlers: { onProfile: (profile: UserProfile | null) => void }) => {
    repositoryState.profileHandler = handlers.onProfile
    handlers.onProfile(repositoryState.signInResult)
    return vi.fn()
  }),
}))

describe('authStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    repositoryState.authUser = null
    repositoryState.signInResult = {
      uid: 'user-1',
      username: 'anil',
      normalizedUsername: 'anil',
      role: 'user',
      archived: false,
      blocked: false,
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
    }
    repositoryState.profileHandler = null
    routerReplace.mockClear()
    signOutUserMock.mockClear()
    vi.resetModules()
  })

  it('rejects blocked users during login and signs them back out', async () => {
    const { useAuthStore } = await import('./authStore')
    const store = useAuthStore()
    repositoryState.signInResult = {
      ...repositoryState.signInResult!,
      blocked: true,
    }

    await expect(store.login('anil', 'greatest')).rejects.toThrow('Your account has been blocked. Contact an administrator.')

    expect(store.errorMessage).toBe('Your account has been blocked. Contact an administrator.')
    expect(store.profile).toBeNull()
    expect(signOutUserMock).toHaveBeenCalled()
    expect(routerReplace).toHaveBeenCalledWith({ name: 'login' })
  })

  it('signs out an active session when the realtime profile becomes blocked', async () => {
    const { useAuthStore } = await import('./authStore')
    const store = useAuthStore()
    repositoryState.authUser = { uid: 'user-1' }

    await store.initialize()

    expect(store.profile?.uid).toBe('user-1')
    expect(repositoryState.profileHandler).not.toBeNull()

    repositoryState.profileHandler?.({
      ...repositoryState.signInResult!,
      blocked: true,
    })

    await vi.waitFor(() => {
      expect(store.profile).toBeNull()
      expect(store.errorMessage).toBe('Your account has been blocked. Contact an administrator.')
      expect(signOutUserMock).toHaveBeenCalled()
      expect(routerReplace).toHaveBeenCalledWith({ name: 'login' })
    })
  })
})
