import { createRouter, createWebHistory } from '@ionic/vue-router'
import LoginView from '../views/LoginView.vue'
import ProjectEditorView from '../views/ProjectEditorView.vue'
import ProjectsDashboardView from '../views/ProjectsDashboardView.vue'
import ArchivedProjectsView from '../views/ArchivedProjectsView.vue'
import UserManagementListView from '../views/UserManagementListView.vue'
import UserManagementDetailView from '../views/UserManagementDetailView.vue'
import ProjectExteriorEditorView from '../views/ProjectExteriorEditorView.vue'
import { pinia } from '../stores'
import { useAuthStore } from '../stores/authStore'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/projects',
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { public: true },
    },
    {
      path: '/projects',
      name: 'projects',
      component: ProjectsDashboardView,
    },
    {
      path: '/projects/archived',
      name: 'projects-archived',
      component: ArchivedProjectsView,
    },
    {
      path: '/admin/users',
      name: 'admin-users',
      component: UserManagementListView,
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/users/:userId',
      name: 'admin-user-detail',
      component: UserManagementDetailView,
      props: true,
      meta: { requiresAdmin: true },
    },
    {
      path: '/projects/:projectId/saves/:saveId',
      name: 'project-editor',
      component: ProjectEditorView,
      props: true,
    },
    {
      path: '/projects/:projectId/exterior/:saveId',
      name: 'project-exterior-editor',
      component: ProjectExteriorEditorView,
      props: true,
    },
  ],
})

router.beforeEach(async (to) => {
  if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }

  const auth = useAuthStore(pinia)
  try {
    await auth.initialize()
  } catch {
    if (to.meta.public) {
      return true
    }

    return { name: 'login' }
  }

  if (to.meta.public && auth.isAuthenticated) {
    return { name: 'projects' }
  }

  if (!to.meta.public && !auth.isAuthenticated) {
    return { name: 'login' }
  }

  if (to.meta.requiresAdmin && !auth.isAdmin) {
    return { name: 'projects' }
  }

  return true
})

export default router
