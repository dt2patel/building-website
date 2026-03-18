<script setup lang="ts">
import { IonContent, IonPage, onIonViewWillEnter } from '@ionic/vue'
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/authStore'
import { useProjectsStore } from '../stores/projectsStore'
import type { UserRole } from '../types/planner'

const auth = useAuthStore()
const projectsStore = useProjectsStore()
const router = useRouter()

const newProjectName = ref('New Planning Project')
const expandedProjectId = ref<string | null>(null)
const loggingOut = ref(false)
const newUser = reactive({
  username: '',
  password: 'greatest',
  role: 'user' as UserRole,
})
const projectAccessDraft = reactive<Record<string, { uid: string; canEdit: boolean }>>({})

const sortedUsers = computed(() => projectsStore.users.filter((user) => !user.archived))

async function loadDashboard() {
  await auth.initialize()
  if (!projectsStore.initialized) {
    await projectsStore.initialize()
  }
  await projectsStore.refreshProjects()
  if (auth.isAdmin) {
    await projectsStore.loadUsersList()
  }
}

onIonViewWillEnter(() => {
  void loadDashboard()
})

watch(() => auth.currentUid, () => {
  void loadDashboard()
})

function openProject(projectId: string, saveId: string) {
  void router.push({
    name: 'project-editor',
    params: {
      projectId,
      saveId,
    },
  })
}

function openExteriorProject(projectId: string, saveId: string) {
  void router.push({
    name: 'project-exterior-editor',
    params: {
      projectId,
      saveId,
    },
  })
}

async function createProjectFromForm() {
  const name = newProjectName.value.trim()
  if (!name) {
    return
  }

  const created = await projectsStore.createNewProject(name)
  await router.push({
    name: 'project-editor',
    params: {
      projectId: created.meta.id,
      saveId: created.saveId,
    },
  })
}

async function cloneProject(projectId: string, saveId: string, name: string) {
  const created = await projectsStore.cloneExistingProject(projectId, saveId, `${name} copy`)
  await router.push({
    name: 'project-editor',
    params: {
      projectId: created.meta.id,
      saveId: created.saveId,
    },
  })
}

async function toggleProjectExpansion(projectId: string) {
  expandedProjectId.value = expandedProjectId.value === projectId ? null : projectId
  if (expandedProjectId.value && auth.isAdmin) {
    await projectsStore.loadProjectMembersList(projectId)
  }
}

async function createManagedUser() {
  if (!newUser.username.trim() || !newUser.password.trim()) {
    return
  }

  await projectsStore.createManagedUser(newUser.username.trim(), newUser.password.trim(), newUser.role)
  newUser.username = ''
  newUser.password = 'greatest'
  newUser.role = 'user'
}

async function addProjectAccess(projectId: string) {
  const draft = accessDraft(projectId)
  if (!draft?.uid) {
    return
  }

  await projectsStore.setProjectMember(projectId, draft.uid, draft.canEdit)
  projectAccessDraft[projectId] = { uid: '', canEdit: true }
}

function accessDraft(projectId: string) {
  if (!projectAccessDraft[projectId]) {
    projectAccessDraft[projectId] = { uid: '', canEdit: true }
  }

  return projectAccessDraft[projectId]
}

async function logout() {
  loggingOut.value = true
  try {
    await auth.logout()
    await router.replace({ name: 'login' })
  } finally {
    loggingOut.value = false
  }
}
</script>

<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="dashboard-shell">
        <section class="dashboard-header panel-card panel-card--hero">
          <div>
            <p class="eyebrow">Workspace</p>
            <h1>Projects Dashboard</h1>
            <p class="muted">Signed in as {{ auth.profile?.username }} • role {{ auth.profile?.role }}</p>
          </div>
          <div class="button-row">
            <button class="button button--ghost" @click="router.push({ name: 'projects-archived' })">
              Archived projects
            </button>
            <button class="button button--ghost" :disabled="loggingOut" @click="logout">
              {{ loggingOut ? 'Signing out...' : 'Log out' }}
            </button>
          </div>
        </section>

        <section class="dashboard-grid">
          <aside class="dashboard-column">
            <section v-if="auth.isAdmin" class="panel-card">
              <p class="eyebrow">Create Project</p>
              <h2>Start a new workspace</h2>
              <label class="field">
                <span>Project name</span>
                <input v-model="newProjectName" name="project-name" type="text" />
              </label>
              <button class="button button--primary" :disabled="projectsStore.creatingProject" @click="createProjectFromForm">
                {{ projectsStore.creatingProject ? 'Creating...' : 'Create project' }}
              </button>
            </section>

            <section v-else class="panel-card">
              <p class="eyebrow">Workspace Access</p>
              <h2>Project creation is admin-only</h2>
              <p class="muted">
                Your account can open projects shared with you, but only admins can create or clone projects.
              </p>
            </section>

            <section v-if="auth.isAdmin" class="panel-card">
              <p class="eyebrow">User Admin</p>
              <h2>Create managed user</h2>
              <label class="field">
                <span>Username</span>
                <input v-model="newUser.username" name="new-username" type="text" />
              </label>
              <label class="field">
                <span>Password</span>
                <input v-model="newUser.password" name="new-password" type="text" />
              </label>
              <label class="field">
                <span>Role</span>
                <select v-model="newUser.role" name="new-role">
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <button class="button button--primary" :disabled="projectsStore.creatingUser" @click="createManagedUser">
                {{ projectsStore.creatingUser ? 'Creating...' : 'Create user' }}
              </button>
              <p class="muted">
                Ongoing role, block, and project-link management lives on the dedicated user management page.
              </p>
              <button class="button button--ghost" @click="router.push({ name: 'admin-users' })">Open user management</button>
            </section>
          </aside>

          <section class="dashboard-column dashboard-column--wide">
            <section class="panel-card">
              <div class="section-heading">
                <div>
                  <p class="eyebrow">Projects</p>
                  <h2>Active projects</h2>
                </div>
                <span class="status-pill status-pill--synced">{{ projectsStore.projects.length }}</span>
              </div>

              <div v-if="!projectsStore.projects.length" class="empty-state">
                <p>No projects yet. Create one to start planning.</p>
              </div>

              <article
                v-for="project in projectsStore.projects"
                :key="project.id"
                class="project-card"
              >
                <div class="project-card__header">
                  <div>
                    <h3>{{ project.name }}</h3>
                    <p class="muted">
                      {{ project.canEdit ? 'Editor access' : 'View-only access' }} • updated {{ project.updatedAt }}
                    </p>
                  </div>
                  <div class="button-row">
                    <button class="button button--ghost" @click="openProject(project.id, project.lastOpenedSaveId || project.defaultSaveId)">
                      Open
                    </button>
                    <button
                      class="button button--ghost"
                      @click="openExteriorProject(project.id, project.defaultSaveId)"
                    >
                      Exterior
                    </button>
                    <button
                      class="button button--ghost"
                      :disabled="!project.canEdit || !auth.isAdmin || projectsStore.cloningProjectIds[project.id]"
                      @click="cloneProject(project.id, project.lastOpenedSaveId || project.defaultSaveId, project.name)"
                    >
                      {{ projectsStore.cloningProjectIds[project.id] ? 'Cloning...' : 'Clone' }}
                    </button>
                    <button
                      class="button button--danger"
                      :disabled="!project.canEdit || projectsStore.archivingProjectIds[project.id]"
                      @click="projectsStore.setProjectArchived(project.id, true)"
                    >
                      {{ projectsStore.archivingProjectIds[project.id] ? 'Archiving...' : 'Archive' }}
                    </button>
                    <button
                      v-if="auth.isAdmin"
                      class="button button--ghost"
                      @click="toggleProjectExpansion(project.id)"
                    >
                      {{ expandedProjectId === project.id ? 'Hide access' : 'Manage access' }}
                    </button>
                  </div>
                </div>

                <div v-if="auth.isAdmin && expandedProjectId === project.id" class="access-panel">
                  <div class="section-heading">
                    <h3>Project access</h3>
                  </div>

                  <div class="member-stack">
                    <div
                      v-for="member in projectsStore.membersByProject[project.id] ?? []"
                      :key="member.uid"
                      class="member-row"
                    >
                      <div>
                        <strong>{{ member.username }}</strong>
                        <p class="muted">{{ member.canEdit ? 'Can edit' : 'View only' }}</p>
                      </div>
                      <div class="button-row">
                        <button
                          class="button button--ghost"
                          :disabled="projectsStore.membershipSavingKeys[`${project.id}:${member.uid}`]"
                          @click="projectsStore.setProjectMember(project.id, member.uid, !member.canEdit)"
                        >
                          {{ projectsStore.membershipSavingKeys[`${project.id}:${member.uid}`] ? 'Saving...' : member.canEdit ? 'Set view' : 'Set edit' }}
                        </button>
                        <button
                          class="button button--danger"
                          :disabled="projectsStore.membershipDeletingKeys[`${project.id}:${member.uid}`]"
                          @click="projectsStore.deleteProjectMember(project.id, member.uid)"
                        >
                          {{ projectsStore.membershipDeletingKeys[`${project.id}:${member.uid}`] ? 'Removing...' : 'Remove' }}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div class="member-form">
                    <label class="field">
                      <span>User</span>
                      <select v-model="accessDraft(project.id).uid" name="project-member-select">
                        <option value="">Select user</option>
                        <option
                          v-for="user in sortedUsers"
                          :key="user.uid"
                          :value="user.uid"
                        >
                          {{ user.username }}
                        </option>
                      </select>
                    </label>
                    <label class="field">
                      <span>Access</span>
                      <select v-model="accessDraft(project.id).canEdit" name="project-member-access">
                        <option :value="true">Editor</option>
                        <option :value="false">Viewer</option>
                      </select>
                    </label>
                    <button
                      class="button button--primary"
                      :disabled="!accessDraft(project.id).uid || projectsStore.membershipSavingKeys[`${project.id}:${accessDraft(project.id).uid}`]"
                      @click="addProjectAccess(project.id)"
                    >
                      {{
                        accessDraft(project.id).uid && projectsStore.membershipSavingKeys[`${project.id}:${accessDraft(project.id).uid}`]
                          ? 'Saving...'
                          : 'Add member'
                      }}
                    </button>
                  </div>
                </div>
              </article>
            </section>
          </section>
        </section>
      </main>
    </ion-content>
  </ion-page>
</template>
