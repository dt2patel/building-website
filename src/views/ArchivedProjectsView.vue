<script setup lang="ts">
import { IonContent, IonPage, onIonViewWillEnter } from '@ionic/vue'
import { useRouter } from 'vue-router'
import { useProjectsStore } from '../stores/projectsStore'

const projectsStore = useProjectsStore()
const router = useRouter()

onIonViewWillEnter(async () => {
  if (!projectsStore.initialized) {
    await projectsStore.initialize()
  }
  await projectsStore.refreshProjects()
})
</script>

<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="archive-shell">
        <section class="panel-card archive-header">
          <div>
            <p class="eyebrow">Archive</p>
            <h1>Archived projects</h1>
            <p class="muted">Restore a project to move it back onto the main dashboard.</p>
          </div>
          <button class="button button--ghost" @click="router.push({ name: 'projects' })">
            Back to dashboard
          </button>
        </section>

        <section class="panel-card">
          <div v-if="!projectsStore.archivedProjects.length" class="empty-state">
            <p>No archived projects.</p>
          </div>

          <article
            v-for="project in projectsStore.archivedProjects"
            :key="project.id"
            class="project-card"
          >
            <div class="project-card__header">
              <div>
                <h3>{{ project.name }}</h3>
                <p class="muted">{{ project.canEdit ? 'Editor access' : 'View-only access' }}</p>
              </div>
              <div class="button-row">
                <button class="button button--ghost" @click="router.push({ name: 'project-editor', params: { projectId: project.id, saveId: project.lastOpenedSaveId || project.defaultSaveId } })">
                  Open
                </button>
                <button
                  class="button button--primary"
                  :disabled="!project.canEdit || projectsStore.restoringProjectIds[project.id]"
                  @click="projectsStore.setProjectArchived(project.id, false)"
                >
                  {{ projectsStore.restoringProjectIds[project.id] ? 'Restoring...' : 'Restore' }}
                </button>
              </div>
            </div>
          </article>
        </section>
      </main>
    </ion-content>
  </ion-page>
</template>
