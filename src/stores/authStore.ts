import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { isFirebaseConfigured } from '../services/firebase'
import {
  ensureDefaultUsers,
  loadCurrentUserProfile,
  signIn,
  signOutUser,
  subscribeToUserProfile,
  subscribeToAuthState,
} from '../services/plannerRepository'
import type { UserProfile } from '../types/planner'

function describeAuthError(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Unable to initialize authentication.'
  }

  if (error.message.includes('auth/configuration-not-found')) {
    return 'Firebase Authentication is not configured for this project. Enable Email/Password sign-in in Firebase Auth.'
  }

  return error.message
}

export const useAuthStore = defineStore('auth', () => {
  const firebaseEnabled = isFirebaseConfigured()
  const initialized = ref(false)
  const loading = ref(false)
  const profile = ref<UserProfile | null>(null)
  const errorMessage = ref('')

  let initPromise: Promise<void> | null = null
  let stopSubscription: (() => void) | null = null
  let stopProfileSubscription: (() => void) | null = null

  const isAuthenticated = computed(() => Boolean(profile.value))
  const isAdmin = computed(() => profile.value?.role === 'admin')
  const currentUid = computed(() => profile.value?.uid ?? null)

  function clearSession() {
    profile.value = null
  }

  async function handleBlockedProfile() {
    clearSession()
    errorMessage.value = 'Your account has been blocked. Contact an administrator.'
    stopProfileSubscription?.()
    stopProfileSubscription = null
    await signOutUser()
    const routerModule = await import('../router')
    await routerModule.default.replace({ name: 'login' })
  }

  function watchCurrentProfile(uid: string) {
    stopProfileSubscription?.()
    stopProfileSubscription = subscribeToUserProfile(uid, {
      onProfile(nextProfile) {
        if (!nextProfile) {
          void signOutUser()
          clearSession()
          return
        }

        if (nextProfile.blocked) {
          void handleBlockedProfile()
          return
        }

        profile.value = nextProfile
      },
    })
  }

  async function hydrateSession(uid: string | null) {
    if (!uid) {
      stopProfileSubscription?.()
      stopProfileSubscription = null
      clearSession()
      return
    }

    profile.value = await loadCurrentUserProfile(uid)
    if (!profile.value) {
      clearSession()
      errorMessage.value = 'Your user profile is missing. Ask an admin to re-provision this account.'
      await signOutUser()
      stopProfileSubscription?.()
      stopProfileSubscription = null
      return
    }

    if (profile.value.blocked) {
      await handleBlockedProfile()
      return
    }

    watchCurrentProfile(uid)
  }

  async function initialize() {
    if (initialized.value) {
      return
    }

    if (initPromise) {
      return initPromise
    }

    if (!firebaseEnabled) {
      initialized.value = true
      errorMessage.value = 'Firebase configuration is missing.'
      return
    }

    initPromise = new Promise((resolve) => {
      let resolved = false
      stopSubscription = subscribeToAuthState(async (user) => {
        loading.value = true
        try {
          await hydrateSession(user?.uid ?? null)
        } finally {
          loading.value = false
          initialized.value = true
          if (!resolved) {
            resolved = true
            resolve()
          }
        }
      })
    })

    await initPromise

    try {
      await ensureDefaultUsers()
    } catch (error) {
      errorMessage.value = describeAuthError(error)
    }
  }

  async function login(username: string, password: string) {
    errorMessage.value = ''
    loading.value = true

    try {
      const nextProfile = await signIn(username, password)
      if (nextProfile.blocked) {
        await handleBlockedProfile()
        throw new Error('Your account has been blocked. Contact an administrator.')
      }

      profile.value = nextProfile
    } catch (error) {
      errorMessage.value = describeAuthError(error)
      throw error
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    loading.value = true
    errorMessage.value = ''

    try {
      await signOutUser()
      clearSession()
    } finally {
      loading.value = false
    }
  }

  return {
    currentUid,
    errorMessage,
    firebaseEnabled,
    initialize,
    initialized,
    isAdmin,
    isAuthenticated,
    loading,
    login,
    logout,
    profile,
    cleanup() {
      stopSubscription?.()
      stopSubscription = null
      stopProfileSubscription?.()
      stopProfileSubscription = null
      initPromise = null
    },
  }
})
