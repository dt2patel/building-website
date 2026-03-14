<script setup lang="ts">
import { IonContent, IonPage, onIonViewWillEnter } from '@ionic/vue'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserManagementStore } from '../stores/userManagementStore'

const router = useRouter()
const userManagement = useUserManagementStore()
const searchQuery = ref('')
const roleFilter = ref<'all' | 'admin' | 'user'>('all')
const statusFilter = ref<'all' | 'active' | 'blocked'>('all')

const filteredUsers = computed(() =>
  userManagement.users.filter((user) => {
    const matchesSearch = user.username.toLowerCase().includes(searchQuery.value.trim().toLowerCase())
    const matchesRole = roleFilter.value === 'all' || user.role === roleFilter.value
    const matchesStatus =
      statusFilter.value === 'all' ||
      (statusFilter.value === 'blocked' ? user.blocked : !user.blocked)

    return matchesSearch && matchesRole && matchesStatus
  }),
)

onIonViewWillEnter(() => {
  void userManagement.initializeUsers()
})
</script>

<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="dashboard-shell">
        <section class="dashboard-header panel-card panel-card--hero">
          <div>
            <p class="eyebrow">Admin</p>
            <h1>User management</h1>
            <p class="muted">Manage roles, blocked accounts, and project access in one place.</p>
          </div>
          <div class="button-row">
            <button class="button button--ghost" @click="router.push({ name: 'projects' })">
              Back to dashboard
            </button>
          </div>
        </section>

        <section class="panel-card">
          <div class="field-grid field-grid--triple">
            <label class="field">
              <span>Search users</span>
              <input v-model="searchQuery" name="user-search" type="text" placeholder="Search by username" />
            </label>
            <label class="field">
              <span>Role</span>
              <select v-model="roleFilter" name="role-filter">
                <option value="all">All roles</option>
                <option value="admin">Admin</option>
                <option value="user">User</option>
              </select>
            </label>
            <label class="field">
              <span>Status</span>
              <select v-model="statusFilter" name="status-filter">
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="blocked">Blocked</option>
              </select>
            </label>
          </div>
          <p v-if="userManagement.errorMessage" class="form-error">{{ userManagement.errorMessage }}</p>
        </section>

        <section class="panel-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Users</p>
              <h2>All accounts</h2>
            </div>
            <span class="status-pill status-pill--synced">{{ filteredUsers.length }}</span>
          </div>

          <div v-if="userManagement.loadingUserList" class="empty-state">
            <p>Loading users...</p>
          </div>

          <div v-else-if="!filteredUsers.length" class="empty-state">
            <p>No users match the current filters.</p>
          </div>

          <article
            v-for="user in filteredUsers"
            :key="user.uid"
            class="project-card user-row"
          >
            <div class="user-row__summary">
              <div>
                <h3>{{ user.username }}</h3>
                <p class="muted">{{ user.projectCount }} linked project{{ user.projectCount === 1 ? '' : 's' }}</p>
              </div>
              <div class="user-row__meta">
                <span class="status-pill" :class="user.blocked ? 'status-pill--error' : 'status-pill--synced'">
                  {{ user.blocked ? 'Blocked' : 'Active' }}
                </span>
                <span class="status-pill status-pill--ghost">{{ user.role }}</span>
                <span class="muted">Updated {{ user.updatedAt }}</span>
              </div>
            </div>
            <div class="button-row">
              <button class="button button--ghost" @click="router.push({ name: 'admin-user-detail', params: { userId: user.uid } })">
                Manage
              </button>
            </div>
          </article>
        </section>
      </main>
    </ion-content>
  </ion-page>
</template>
