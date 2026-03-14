import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useAuthStore } from './authStore'
import {
  linkUserToProject,
  listUsers,
  loadAllProjectMetas,
  loadUserMemberships,
  loadUserProfile,
  setUserBlocked,
  setUserProjectAccess,
  unlinkUserFromProject,
  updateUserRole,
} from '../services/plannerRepository'
import type { ProjectMembership, ProjectMeta, UserProfile, UserRole } from '../types/planner'

type MembershipKey = `${string}:${string}`

export interface ManagedUserListItem extends UserProfile {
  projectCount: number
}

function membershipKey(uid: string, projectId: string): MembershipKey {
  return `${uid}:${projectId}`
}

export const useUserManagementStore = defineStore('user-management', () => {
  const auth = useAuthStore()
  const users = ref<ManagedUserListItem[]>([])
  const selectedUser = ref<UserProfile | null>(null)
  const selectedUserMemberships = ref<ProjectMembership[]>([])
  const allProjects = ref<ProjectMeta[]>([])
  const availableProjectsForLinking = ref<ProjectMeta[]>([])
  const loadingUserList = ref(false)
  const loadingUserDetail = ref(false)
  const savingRole = ref(false)
  const blockingUser = ref(false)
  const linkingProject = ref(false)
  const updatingMembershipKeys = ref<Record<MembershipKey, boolean>>({})
  const unlinkingMembershipKeys = ref<Record<MembershipKey, boolean>>({})
  const errorMessage = ref('')

  const selectedMembershipProjectIds = computed(() =>
    new Set(selectedUserMemberships.value.map((membership) => membership.projectId)),
  )

  function setUpdatingMembership(uid: string, projectId: string, nextValue: boolean) {
    updatingMembershipKeys.value[membershipKey(uid, projectId)] = nextValue
  }

  function setUnlinkingMembership(uid: string, projectId: string, nextValue: boolean) {
    unlinkingMembershipKeys.value[membershipKey(uid, projectId)] = nextValue
  }

  async function initializeUsers() {
    loadingUserList.value = true
    errorMessage.value = ''

    try {
      const loadedUsers = await listUsers()
      const membershipCounts = await Promise.all(
        loadedUsers.map(async (user) => ({
          uid: user.uid,
          count: (await loadUserMemberships(user.uid)).length,
        })),
      )

      const countsByUid = Object.fromEntries(membershipCounts.map((entry) => [entry.uid, entry.count]))
      users.value = loadedUsers.map((user) => ({
        ...user,
        projectCount: countsByUid[user.uid] ?? 0,
      }))
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : 'User list failed to load.'
    } finally {
      loadingUserList.value = false
    }
  }

  async function loadUserDetail(uid: string) {
    loadingUserDetail.value = true
    errorMessage.value = ''

    try {
      const [user, memberships, projects] = await Promise.all([
        loadUserProfile(uid),
        loadUserMemberships(uid),
        loadAllProjectMetas(),
      ])

      if (!user) {
        throw new Error('User detail failed to load.')
      }

      selectedUser.value = user
      selectedUserMemberships.value = memberships
      allProjects.value = projects
      availableProjectsForLinking.value = projects.filter((project) =>
        !project.archived && !memberships.some((membership) => membership.projectId === project.id),
      )
    } catch (error) {
      selectedUser.value = null
      selectedUserMemberships.value = []
      availableProjectsForLinking.value = []
      errorMessage.value = error instanceof Error ? error.message : 'User detail failed to load.'
      throw error
    } finally {
      loadingUserDetail.value = false
    }
  }

  async function refreshSelectedUser() {
    if (!selectedUser.value) {
      return
    }

    await loadUserDetail(selectedUser.value.uid)
  }

  async function saveUserRole(uid: string, role: UserRole) {
    savingRole.value = true
    errorMessage.value = ''

    try {
      await updateUserRole(uid, role)
      await Promise.all([
        initializeUsers(),
        refreshSelectedUser(),
      ])
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : 'Role update failed.'
      throw error
    } finally {
      savingRole.value = false
    }
  }

  async function blockUser(uid: string) {
    if (!auth.currentUid) {
      throw new Error('Admin profile not found.')
    }

    blockingUser.value = true
    errorMessage.value = ''

    try {
      await setUserBlocked(uid, true, auth.currentUid)
      await Promise.all([
        initializeUsers(),
        refreshSelectedUser(),
      ])
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : 'Block user failed.'
      throw error
    } finally {
      blockingUser.value = false
    }
  }

  async function unblockUser(uid: string) {
    if (!auth.currentUid) {
      throw new Error('Admin profile not found.')
    }

    blockingUser.value = true
    errorMessage.value = ''

    try {
      await setUserBlocked(uid, false, auth.currentUid)
      await Promise.all([
        initializeUsers(),
        refreshSelectedUser(),
      ])
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : 'Unblock user failed.'
      throw error
    } finally {
      blockingUser.value = false
    }
  }

  async function linkProject(uid: string, projectId: string, canEdit: boolean) {
    linkingProject.value = true
    errorMessage.value = ''

    try {
      await linkUserToProject(uid, projectId, canEdit)
      await Promise.all([
        initializeUsers(),
        refreshSelectedUser(),
      ])
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : 'Link project failed.'
      throw error
    } finally {
      linkingProject.value = false
    }
  }

  async function updateLinkedProjectAccess(uid: string, projectId: string, canEdit: boolean) {
    const key = membershipKey(uid, projectId)
    setUpdatingMembership(uid, projectId, true)
    errorMessage.value = ''

    try {
      await setUserProjectAccess(uid, projectId, canEdit)
      await Promise.all([
        initializeUsers(),
        refreshSelectedUser(),
      ])
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : 'Access update failed.'
      throw error
    } finally {
      updatingMembershipKeys.value[key] = false
    }
  }

  async function unlinkProject(uid: string, projectId: string) {
    const key = membershipKey(uid, projectId)
    setUnlinkingMembership(uid, projectId, true)
    errorMessage.value = ''

    try {
      await unlinkUserFromProject(uid, projectId)
      await Promise.all([
        initializeUsers(),
        refreshSelectedUser(),
      ])
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : 'Unlink project failed.'
      throw error
    } finally {
      unlinkingMembershipKeys.value[key] = false
    }
  }

  return {
    allProjects,
    availableProjectsForLinking,
    blockingUser,
    errorMessage,
    initializeUsers,
    linkingProject,
    loadUserDetail,
    loadingUserDetail,
    loadingUserList,
    savingRole,
    selectedMembershipProjectIds,
    selectedUser,
    selectedUserMemberships,
    unlinkProject,
    unlinkingMembershipKeys,
    updateLinkedProjectAccess,
    updatingMembershipKeys,
    users,
    linkProject,
    saveUserRole,
    blockUser,
    unblockUser,
  }
})
