<script setup lang="ts">
import { IonContent, IonPage, onIonViewWillEnter } from '@ionic/vue'
import { computed, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/authStore'
import { useUserManagementStore } from '../stores/userManagementStore'
import type { ProjectMeta, UserRole } from '../types/planner'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const userManagement = useUserManagementStore()
const draft = reactive({
  role: 'user' as UserRole,
  projectId: '',
  canEdit: false,
})
const membershipAccessDraft = reactive<Record<string, boolean>>({})

const selectedProjectMeta = computed<Record<string, ProjectMeta>>(() =>
  Object.fromEntries(userManagement.allProjects.map((project) => [project.id, project])),
)

const isSelf = computed(() => auth.currentUid === userManagement.selectedUser?.uid)
const selectedUserId = computed(() => String(route.params.userId ?? ''))

async function loadDetail() {
  if (!selectedUserId.value) {
    await router.replace({ name: 'admin-users' })
    return
  }

  try {
    await userManagement.loadUserDetail(selectedUserId.value)
  } catch {
    return
  }
}

watch(
  () => userManagement.selectedUser,
  (user) => {
    if (!user) {
      return
    }

    draft.role = user.role
  },
  { immediate: true },
)

watch(
  () => userManagement.selectedUserMemberships,
  (memberships) => {
    memberships.forEach((membership) => {
      membershipAccessDraft[membership.projectId] = membership.canEdit
    })
  },
  { immediate: true },
)

async function saveRole() {
  if (!userManagement.selectedUser) {
    return
  }

  await userManagement.saveUserRole(userManagement.selectedUser.uid, draft.role)
}

async function toggleBlocked() {
  if (!userManagement.selectedUser) {
    return
  }

  if (userManagement.selectedUser.blocked) {
    await userManagement.unblockUser(userManagement.selectedUser.uid)
    return
  }

  await userManagement.blockUser(userManagement.selectedUser.uid)
}

async function linkProject() {
  if (!userManagement.selectedUser || !draft.projectId) {
    return
  }

  await userManagement.linkProject(userManagement.selectedUser.uid, draft.projectId, draft.canEdit)
  draft.projectId = ''
  draft.canEdit = false
}

async function saveProjectAccess(projectId: string) {
  if (!userManagement.selectedUser) {
    return
  }

  await userManagement.updateLinkedProjectAccess(
    userManagement.selectedUser.uid,
    projectId,
    membershipAccessDraft[projectId] ?? false,
  )
}

async function unlinkProject(projectId: string) {
  if (!userManagement.selectedUser) {
    return
  }

  await userManagement.unlinkProject(userManagement.selectedUser.uid, projectId)
}

function openProject(projectId: string) {
  const project = selectedProjectMeta.value[projectId]
  if (!project) {
    return
  }

  void router.push({
    name: 'project-editor',
    params: {
      projectId,
      saveId: project.lastOpenedSaveId || project.defaultSaveId,
    },
  })
}

onIonViewWillEnter(() => {
  void loadDetail()
})

watch(() => route.params.userId, () => {
  void loadDetail()
})
</script>

<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="dashboard-shell">
        <section class="dashboard-header panel-card panel-card--hero">
          <div>
            <p class="eyebrow">Admin</p>
            <h1>{{ userManagement.selectedUser?.username ?? 'User detail' }}</h1>
            <p class="muted">
              {{ userManagement.selectedUser?.blocked ? 'Blocked account' : 'Active account' }} • role
              {{ userManagement.selectedUser?.role ?? 'unknown' }}
            </p>
          </div>
          <div class="button-row">
            <button class="button button--ghost" @click="router.push({ name: 'admin-users' })">
              Back to users
            </button>
          </div>
        </section>

        <section v-if="userManagement.errorMessage" class="panel-card">
          <p class="form-error">{{ userManagement.errorMessage }}</p>
        </section>

        <section v-if="userManagement.loadingUserDetail" class="panel-card">
          <p>Loading user detail...</p>
        </section>

        <template v-else-if="userManagement.selectedUser">
          <section class="panel-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Summary</p>
                <h2>User summary</h2>
              </div>
            </div>

            <div class="field-grid field-grid--triple">
              <label class="field">
                <span>Username</span>
                <input :value="userManagement.selectedUser.username" disabled />
              </label>
              <label class="field">
                <span>Role</span>
                <select v-model="draft.role" :name="`detail-role-${userManagement.selectedUser.uid}`">
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label class="field">
                <span>Status</span>
                <input :value="userManagement.selectedUser.blocked ? 'Blocked' : 'Active'" disabled />
              </label>
            </div>

            <div class="field-grid field-grid--double">
              <label class="field">
                <span>Created</span>
                <input :value="userManagement.selectedUser.createdAt" disabled />
              </label>
              <label class="field">
                <span>Updated</span>
                <input :value="userManagement.selectedUser.updatedAt" disabled />
              </label>
            </div>

            <div class="button-row">
              <button
                class="button button--ghost"
                :disabled="userManagement.savingRole || (isSelf && draft.role === 'user') || draft.role === userManagement.selectedUser.role"
                @click="saveRole"
              >
                {{ userManagement.savingRole ? 'Saving...' : 'Save role' }}
              </button>
              <button
                class="button"
                :class="userManagement.selectedUser.blocked ? 'button--primary' : 'button--danger'"
                :disabled="userManagement.blockingUser || isSelf"
                @click="toggleBlocked"
              >
                {{
                  userManagement.blockingUser
                    ? userManagement.selectedUser.blocked ? 'Unblocking...' : 'Blocking...'
                    : userManagement.selectedUser.blocked ? 'Unblock user' : 'Block user'
                }}
              </button>
            </div>

            <p v-if="isSelf && draft.role === 'user'" class="muted">
              You cannot remove your own admin access from here.
            </p>
            <p v-if="isSelf" class="muted">
              You cannot block your own account.
            </p>
            <p class="muted">
              Blocked users are signed out and cannot log in until unblocked.
            </p>
          </section>

          <section class="panel-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Linked Projects</p>
                <h2>Current access</h2>
              </div>
            </div>

            <div v-if="!userManagement.selectedUserMemberships.length" class="empty-state">
              <p>This user has no linked projects.</p>
            </div>

            <article
              v-for="membership in userManagement.selectedUserMemberships"
              :key="membership.projectId"
              class="project-card"
            >
              <div class="project-card__header">
                <div>
                  <h3>{{ membership.projectName }}</h3>
                  <p class="muted">{{ selectedProjectMeta[membership.projectId]?.archived ? 'Archived project' : 'Active project' }}</p>
                </div>
                <div class="button-row">
                  <label class="field field--compact">
                    <span>Access</span>
                    <select v-model="membershipAccessDraft[membership.projectId]" :name="`access-${membership.projectId}`">
                      <option :value="false">Viewer</option>
                      <option :value="true">Editor</option>
                    </select>
                  </label>
                  <button
                    class="button button--ghost"
                    :disabled="userManagement.updatingMembershipKeys[`${userManagement.selectedUser.uid}:${membership.projectId}`] || membershipAccessDraft[membership.projectId] === membership.canEdit"
                    @click="saveProjectAccess(membership.projectId)"
                  >
                    {{
                      userManagement.updatingMembershipKeys[`${userManagement.selectedUser.uid}:${membership.projectId}`]
                        ? 'Saving...'
                        : 'Save access'
                    }}
                  </button>
                  <button
                    class="button button--ghost"
                    :disabled="!selectedProjectMeta[membership.projectId]"
                    @click="openProject(membership.projectId)"
                  >
                    Open
                  </button>
                  <button
                    class="button button--danger"
                    :disabled="userManagement.unlinkingMembershipKeys[`${userManagement.selectedUser.uid}:${membership.projectId}`]"
                    @click="unlinkProject(membership.projectId)"
                  >
                    {{
                      userManagement.unlinkingMembershipKeys[`${userManagement.selectedUser.uid}:${membership.projectId}`]
                        ? 'Unlinking...'
                        : 'Unlink'
                    }}
                  </button>
                </div>
              </div>
            </article>
          </section>

          <section class="panel-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Link Project</p>
                <h2>Add project access</h2>
              </div>
            </div>

            <div class="member-form">
              <label class="field">
                <span>Project</span>
                <select v-model="draft.projectId" name="link-project">
                  <option value="">Select project</option>
                  <option
                    v-for="project in userManagement.availableProjectsForLinking"
                    :key="project.id"
                    :value="project.id"
                  >
                    {{ project.name }}
                  </option>
                </select>
              </label>
              <label class="field">
                <span>Access</span>
                <select v-model="draft.canEdit" name="link-project-access">
                  <option :value="false">Viewer</option>
                  <option :value="true">Editor</option>
                </select>
              </label>
              <button
                class="button button--primary"
                :disabled="userManagement.linkingProject || !draft.projectId"
                @click="linkProject"
              >
                {{ userManagement.linkingProject ? 'Linking...' : 'Link project' }}
              </button>
            </div>
          </section>

          <section class="panel-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Deferred</p>
                <h2>Password reset</h2>
              </div>
            </div>
            <p class="muted">Password reset requires a backend admin function and is not enabled yet.</p>
          </section>
        </template>
      </main>
    </ion-content>
  </ion-page>
</template>
