import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useAuthStore } from './authStore'
import {
  archiveProject,
  cloneProject,
  createProject,
  createUser,
  listUsers,
  loadProjectMembers,
  loadProjectsForUser,
  migrateLegacyProjectForAdmin,
  removeProjectMembership,
  updateUserRole,
  updateProjectMembership,
} from '../services/plannerRepository'
import type { ProjectMember, ProjectMeta, UserProfile, UserRole } from '../types/planner'

type ProjectListItem = ProjectMeta & { canEdit: boolean }
type MembershipKey = `${string}:${string}`

function membershipKey(projectId: string, uid: string): MembershipKey {
  return `${projectId}:${uid}`
}

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<ProjectListItem[]>([])
  const archivedProjects = ref<ProjectListItem[]>([])
  const users = ref<UserProfile[]>([])
  const membersByProject = ref<Record<string, ProjectMember[]>>({})
  const initialized = ref(false)
  const initializedForUid = ref<string | null>(null)
  const loading = ref(false)
  const creatingProject = ref(false)
  const cloningProjectIds = ref<Record<string, boolean>>({})
  const archivingProjectIds = ref<Record<string, boolean>>({})
  const restoringProjectIds = ref<Record<string, boolean>>({})
  const creatingUser = ref(false)
  const userRoleSavingIds = ref<Record<string, boolean>>({})
  const membershipSavingKeys = ref<Record<MembershipKey, boolean>>({})
  const membershipDeletingKeys = ref<Record<MembershipKey, boolean>>({})
  const errorMessage = ref('')

  const auth = useAuthStore()

  async function refreshProjects() {
    await auth.initialize()

    if (!auth.currentUid) {
      projects.value = []
      archivedProjects.value = []
      return
    }

    const [active, archived] = await Promise.all([
      loadProjectsForUser(auth.currentUid, { archived: false }),
      loadProjectsForUser(auth.currentUid, { archived: true }),
    ])

    projects.value = active
    archivedProjects.value = archived
  }

  async function initialize() {
    await auth.initialize()
    if (initialized.value && initializedForUid.value === auth.currentUid) {
      return
    }

    membersByProject.value = {}
    users.value = []

    if (!auth.currentUid) {
      projects.value = []
      archivedProjects.value = []
      initialized.value = true
      initializedForUid.value = null
      return
    }

    loading.value = true
    errorMessage.value = ''

    try {
      if (auth.isAdmin) {
        await migrateLegacyProjectForAdmin(auth.currentUid)
      }
      await refreshProjects()
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : 'Unable to load projects.'
    } finally {
      loading.value = false
      initialized.value = true
      initializedForUid.value = auth.currentUid
    }
  }

  async function createNewProject(name: string) {
    if (!auth.currentUid) {
      throw new Error('You must be signed in to create a project.')
    }

    if (!auth.isAdmin) {
      throw new Error('Only admins can create projects.')
    }

    creatingProject.value = true
    try {
      const created = await createProject({
        name,
        creatorUid: auth.currentUid,
      })
      await refreshProjects()
      return created
    } finally {
      creatingProject.value = false
    }
  }

  async function cloneExistingProject(projectId: string, saveId: string, newProjectName: string) {
    if (!auth.currentUid) {
      throw new Error('You must be signed in to clone a project.')
    }

    if (!auth.isAdmin) {
      throw new Error('Only admins can clone projects.')
    }

    cloningProjectIds.value[projectId] = true
    try {
      const created = await cloneProject({
        sourceProjectId: projectId,
        sourceSaveId: saveId,
        newProjectName,
        creatorUid: auth.currentUid,
      })
      await refreshProjects()
      return created
    } finally {
      cloningProjectIds.value[projectId] = false
    }
  }

  async function setProjectArchived(projectId: string, archived: boolean) {
    if (archived) {
      archivingProjectIds.value[projectId] = true
    } else {
      restoringProjectIds.value[projectId] = true
    }
    try {
      await archiveProject(projectId, archived)
      await refreshProjects()
    } finally {
      if (archived) {
        archivingProjectIds.value[projectId] = false
      } else {
        restoringProjectIds.value[projectId] = false
      }
    }
  }

  async function loadProjectMembersList(projectId: string) {
    membersByProject.value[projectId] = await loadProjectMembers(projectId)
  }

  async function setProjectMember(projectId: string, uid: string, canEdit: boolean) {
    if (!auth.isAdmin) {
      throw new Error('Only admins can manage project access.')
    }

    const key = membershipKey(projectId, uid)
    membershipSavingKeys.value[key] = true
    try {
      await updateProjectMembership(projectId, uid, { canEdit })
      await Promise.all([
        loadProjectMembersList(projectId),
        refreshProjects(),
      ])
    } finally {
      membershipSavingKeys.value[key] = false
    }
  }

  async function deleteProjectMember(projectId: string, uid: string) {
    if (!auth.isAdmin) {
      throw new Error('Only admins can manage project access.')
    }

    const key = membershipKey(projectId, uid)
    membershipDeletingKeys.value[key] = true
    try {
      await removeProjectMembership(projectId, uid)
      await loadProjectMembersList(projectId)
    } finally {
      membershipDeletingKeys.value[key] = false
    }
  }

  async function loadUsersList() {
    if (!auth.isAdmin) {
      users.value = []
      return
    }

    users.value = await listUsers()
  }

  async function createManagedUser(username: string, password: string, role: UserRole) {
    if (!auth.isAdmin) {
      throw new Error('Only admins can create users.')
    }

    creatingUser.value = true
    try {
      const created = await createUser({ username, password, role })
      await loadUsersList()
      return created
    } finally {
      creatingUser.value = false
    }
  }

  async function setUserRole(uid: string, role: UserRole) {
    if (!auth.isAdmin) {
      throw new Error('Only admins can manage users.')
    }
    userRoleSavingIds.value[uid] = true
    try {
      await updateUserRole(uid, role)
      await loadUsersList()
    } finally {
      userRoleSavingIds.value[uid] = false
    }
  }

  return {
    archivedProjects,
    createManagedUser,
    createNewProject,
    creatingProject,
    creatingUser,
    cloningProjectIds,
    cloneExistingProject,
    deleteProjectMember,
    errorMessage,
    archivingProjectIds,
    initialize,
    initialized,
    loadProjectMembersList,
    loadUsersList,
    loading,
    membershipDeletingKeys,
    membershipSavingKeys,
    membersByProject,
    projects,
    refreshProjects,
    restoringProjectIds,
    setProjectArchived,
    setProjectMember,
    userRoleSavingIds,
    setUserRole,
    users,
  }
})
