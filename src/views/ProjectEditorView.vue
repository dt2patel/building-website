<script setup lang="ts">
import { IonContent, IonPage, onIonViewWillEnter, onIonViewWillLeave } from '@ionic/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EditorCanvas from '../components/planner/EditorCanvas.vue'
import InspectorPanel from '../components/planner/InspectorPanel.vue'
import { toDisplayValue } from '../lib/geometry'
import { useAuthStore } from '../stores/authStore'
import { usePlannerStore } from '../stores/plannerStore'
import { useProjectsStore } from '../stores/projectsStore'
import { layerLabels, layerOrder, type MeasurementUnit, type ToolMode } from '../types/planner'

const auth = useAuthStore()
const planner = usePlannerStore()
const projectsStore = useProjectsStore()
const route = useRoute()
const router = useRouter()
const editorCanvas = ref<InstanceType<typeof EditorCanvas> | null>(null)
const toolModes: ToolMode[] = ['select', 'point', 'polyline', 'polygon']
const saveAsName = ref('')
const navigationPending = ref(false)
let keydownListenerAttached = false

const projectAccess = computed(() =>
  [...projectsStore.projects, ...projectsStore.archivedProjects]
    .find((project) => project.id === String(route.params.projectId)),
)

const activeLayerTemplates = computed(
  () => planner.templatesByLayer[planner.activeLayerType],
)

function plotVertexValue(index: number, axis: 'x' | 'y') {
  const vertex = planner.project?.plotBoundary[index]
  return vertex ? toDisplayValue(vertex[axis], planner.project?.gridUnit ?? 'm') : 0
}

function updateGridUnit(event: Event) {
  const nextUnit = (event.target as HTMLSelectElement).value as MeasurementUnit
  if (!planner.project) {
    return
  }
  planner.updateGridSettings(nextUnit, planner.project.gridSpacing)
}

function updateGridSpacing(event: Event) {
  if (!planner.project) {
    return
  }

  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isNaN(value) && value > 0) {
    planner.updateGridSettings(planner.project.gridUnit, value)
  }
}

function updatePlotVertex(index: number, axis: 'x' | 'y', event: Event) {
  if (!planner.project) {
    return
  }

  planner.updatePlotVertex(
    index,
    axis,
    Number((event.target as HTMLInputElement).value),
    planner.project.gridUnit,
  )
}

async function exportCurrentFloor() {
  const svg = editorCanvas.value?.getSvgElement()
  if (!svg) {
    return
  }

  await planner.exportActiveFloor(svg)
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.key !== 'Delete' && event.key !== 'Backspace') {
    return
  }

  const target = event.target as HTMLElement | null
  const tagName = target?.tagName
  const isFormField =
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    target?.isContentEditable

  if (isFormField || !planner.selectedEntity || !planner.canEdit) {
    return
  }

  event.preventDefault()
  planner.deleteSelectedEntity()
}

function attachKeydownListener() {
  if (keydownListenerAttached) {
    return
  }

  window.addEventListener('keydown', handleGlobalKeydown)
  keydownListenerAttached = true
}

function detachKeydownListener() {
  if (!keydownListenerAttached) {
    return
  }

  window.removeEventListener('keydown', handleGlobalKeydown)
  keydownListenerAttached = false
}

async function hydrateEditor() {
  await auth.initialize()
  await projectsStore.initialize()

  const projectId = String(route.params.projectId ?? '')
  const saveId = String(route.params.saveId ?? '')
  const access = projectAccess.value

  if (!projectId || !saveId || !access) {
    await router.replace({ name: 'projects' })
    return
  }

  await planner.initialize({
    projectId,
    saveId,
    canEdit: access.canEdit,
  })
}

async function openSave(saveId: string) {
  await router.push({
    name: 'project-editor',
    params: {
      projectId: String(route.params.projectId),
      saveId,
    },
  })
}

async function saveAs() {
  const saveId = await planner.createSaveAs(saveAsName.value.trim() || undefined)
  saveAsName.value = ''
  if (saveId) {
    await openSave(saveId)
  }
}

async function archiveSave(saveId: string, archived: boolean) {
  const fallbackSaveId = await planner.setSaveArchived(saveId, archived)
  if (fallbackSaveId) {
    await openSave(fallbackSaveId)
  }
}

async function cloneCurrentProject() {
  if (!planner.projectMeta || !planner.activeSaveId) {
    return
  }

  navigationPending.value = true
  try {
    const created = await projectsStore.cloneExistingProject(
      planner.projectMeta.id,
      planner.activeSaveId,
      planner.projectMeta.name,
    )
    await router.push({
      name: 'project-editor',
      params: {
        projectId: created.meta.id,
        saveId: created.saveId,
      },
    })
  } finally {
    navigationPending.value = false
  }
}

async function archiveCurrentProject() {
  if (!planner.projectMeta) {
    return
  }

  navigationPending.value = true
  try {
    await projectsStore.setProjectArchived(planner.projectMeta.id, true)
    await router.replace({ name: 'projects' })
  } finally {
    navigationPending.value = false
  }
}

onIonViewWillEnter(async () => {
  await hydrateEditor()
  attachKeydownListener()
})

onIonViewWillLeave(() => {
  detachKeydownListener()
  planner.cleanup()
})

watch(
  () => [route.params.projectId, route.params.saveId, projectAccess.value?.canEdit],
  async () => {
    await hydrateEditor()
  },
)

onBeforeUnmount(() => {
  detachKeydownListener()
  planner.cleanup()
})
</script>

<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="workspace">
        <aside class="sidebar">
          <div class="panel-card panel-card--hero">
            <p class="eyebrow">Blueprint Planner</p>
            <h1>{{ planner.projectMeta?.name ?? planner.project?.name ?? 'Project' }}</h1>
            <p>
              Active save:
              <strong>{{ planner.availableSaves.find((save) => save.id === planner.activeSaveId)?.name ?? planner.activeSaveId }}</strong>
            </p>
          </div>

          <section class="panel-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Navigation</p>
                <h2>Project actions</h2>
              </div>
            </div>

            <div class="button-row button-row--wrap">
              <button class="button button--ghost" @click="router.push({ name: 'projects' })">Dashboard</button>
              <button
                class="button button--ghost"
                :disabled="!projectAccess?.canEdit || !planner.projectMeta || projectsStore.cloningProjectIds[planner.projectMeta.id] || navigationPending"
                @click="cloneCurrentProject"
              >
                {{ planner.projectMeta && projectsStore.cloningProjectIds[planner.projectMeta.id] ? 'Cloning...' : 'Clone project' }}
              </button>
              <button
                class="button button--danger"
                :disabled="!projectAccess?.canEdit || !planner.projectMeta || projectsStore.archivingProjectIds[planner.projectMeta.id] || navigationPending"
                @click="archiveCurrentProject"
              >
                {{ planner.projectMeta && projectsStore.archivingProjectIds[planner.projectMeta.id] ? 'Archiving...' : 'Archive project' }}
              </button>
            </div>
          </section>

          <section class="panel-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Saves</p>
                <h2>Save versions</h2>
              </div>
            </div>

            <label class="field">
              <span>Save As name</span>
              <input v-model="saveAsName" name="save-as-name" type="text" placeholder="Auto-name by time if blank" />
            </label>
            <button class="button button--primary" :disabled="!planner.canEdit" @click="saveAs">Save As</button>

            <div class="save-stack">
              <article
                v-for="save in planner.availableSaves"
                :key="save.id"
                class="save-row"
                :class="{ 'save-row--active': planner.activeSaveId === save.id }"
              >
                <div>
                  <strong>{{ save.name }}</strong>
                  <p class="muted">{{ save.isDefault ? 'Default save' : 'Forked save' }}</p>
                </div>
                <div class="button-row">
                  <button class="button button--ghost" @click="openSave(save.id)">Open</button>
                  <button
                    class="button button--danger"
                    :disabled="!planner.canEdit || save.isDefault"
                    @click="archiveSave(save.id, true)"
                  >
                    Archive
                  </button>
                </div>
              </article>
            </div>

            <div v-if="planner.archivedSaves.length" class="save-archive">
              <p class="eyebrow">Archived saves</p>
              <article
                v-for="save in planner.archivedSaves"
                :key="save.id"
                class="save-row"
              >
                <div>
                  <strong>{{ save.name }}</strong>
                  <p class="muted">Archived</p>
                </div>
                <div class="button-row">
                  <button class="button button--ghost" @click="openSave(save.id)">Open</button>
                  <button
                    class="button button--primary"
                    :disabled="!planner.canEdit"
                    @click="archiveSave(save.id, false)"
                  >
                    Restore
                  </button>
                </div>
              </article>
            </div>
          </section>

          <section class="panel-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Floors</p>
                <h2>Choose a floor</h2>
              </div>
            </div>

            <div class="pill-grid">
              <button
                v-for="floor in planner.project?.floors ?? []"
                :key="floor.id"
                class="pill-button"
                :class="{ 'pill-button--active': planner.selectedFloorId === floor.id }"
                @click="planner.selectFloor(floor.id)"
              >
                {{ floor.name }}
              </button>
            </div>
          </section>

          <section class="panel-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Project Geometry</p>
                <h2>Plot and grid settings</h2>
              </div>
            </div>

            <div class="field-grid">
              <label class="field">
                <span>Grid unit</span>
                <select
                  name="grid-unit"
                  :value="planner.project?.gridUnit ?? 'm'"
                  :disabled="!planner.canEdit"
                  @change="updateGridUnit"
                >
                  <option value="m">Meters</option>
                  <option value="cm">Centimeters</option>
                </select>
              </label>

              <label class="field">
                <span>Grid spacing</span>
                <input
                  name="grid-spacing"
                  type="number"
                  min="0.01"
                  step="0.01"
                  :value="planner.project?.gridSpacing ?? 1"
                  :disabled="!planner.canEdit"
                  @change="updateGridSpacing"
                />
              </label>
            </div>

            <div class="plot-vertex-grid">
              <label
                v-for="(_, index) in planner.project?.plotBoundary ?? []"
                :key="`plot-vertex-${index}`"
                class="plot-vertex"
              >
                <span>P{{ index + 1 }}</span>
                <div class="field-grid">
                  <input
                    :name="`plot-${index + 1}-x`"
                    type="number"
                    step="0.01"
                    :value="plotVertexValue(index, 'x')"
                    :disabled="!planner.canEdit"
                    @change="updatePlotVertex(index, 'x', $event)"
                  />
                  <input
                    :name="`plot-${index + 1}-y`"
                    type="number"
                    step="0.01"
                    :value="plotVertexValue(index, 'y')"
                    :disabled="!planner.canEdit"
                    @change="updatePlotVertex(index, 'y', $event)"
                  />
                </div>
              </label>
            </div>
          </section>

          <section class="panel-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Layers</p>
                <h2>Switch planning mode</h2>
              </div>
            </div>

            <div class="layer-stack">
              <label
                v-for="layerType in layerOrder"
                :key="layerType"
                class="layer-row"
                :class="{ 'layer-row--active': planner.activeLayerType === layerType }"
              >
                <div class="layer-row__main">
                  <input
                    type="radio"
                    name="active-layer"
                    :checked="planner.activeLayerType === layerType"
                    @change="planner.setActiveLayer(layerType)"
                  />
                  <span>{{ layerLabels[layerType] }}</span>
                </div>
                <button class="visibility-toggle" @click.prevent="planner.toggleLayerVisibility(layerType)">
                  {{ planner.layerVisibility[layerType] ? 'Hide' : 'Show' }}
                </button>
              </label>
            </div>
          </section>

          <section class="panel-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Templates</p>
                <h2>Layer source</h2>
              </div>
            </div>

            <label class="field">
              <span>{{ layerLabels[planner.activeLayerType] }} template</span>
              <select
                name="layer-template"
                :value="planner.currentTemplateId ?? ''"
                :disabled="!planner.canEdit"
                @change="planner.assignTemplate(planner.activeLayerType, ($event.target as HTMLSelectElement).value || null)"
              >
                <option value="">No template assigned</option>
                <option
                  v-for="template in activeLayerTemplates"
                  :key="template.id"
                  :value="template.id"
                >
                  {{ template.name }}
                </option>
              </select>
            </label>

            <div class="button-row">
              <button class="button button--ghost" :disabled="!planner.canEdit" @click="planner.createTemplate()">New</button>
              <button class="button button--ghost" :disabled="!planner.canEdit || !planner.currentTemplate" @click="planner.cloneCurrentTemplate()">
                Clone
              </button>
            </div>
          </section>
        </aside>

        <section class="canvas-shell">
          <div class="toolbar">
            <div class="toolbar__group">
              <button
                v-for="tool in toolModes"
                :key="tool"
                class="tool-button"
                :class="{ 'tool-button--active': planner.toolMode === tool }"
                :disabled="tool !== 'select' && !planner.canEdit"
                @click="planner.setToolMode(tool)"
              >
                {{ tool }}
              </button>
            </div>

            <div class="toolbar__group toolbar__group--meta">
              <span class="status-pill" :class="`status-pill--${planner.syncState}`">{{ planner.syncState }}</span>
              <p v-if="!planner.canEdit" class="toolbar__notice">
                {{ projectAccess?.canEdit ? 'Editing is unavailable right now.' : 'You have view-only access.' }}
              </p>
              <button class="button button--ghost" @click="planner.persist()">Sync now</button>
              <button class="button button--primary" @click="exportCurrentFloor">Export PDF</button>
            </div>
          </div>

          <EditorCanvas
            ref="editorCanvas"
            :active-layer-type="planner.activeLayerType"
            :draft-style="planner.draftStyle"
            :draft-vertices="planner.draftVertices"
            :floor="planner.selectedFloor"
            :project="planner.project"
            :selected-entity-id="planner.selectedEntityId"
            :tool-mode="planner.toolMode"
            :visible-templates="planner.visibleTemplates"
            :editable="planner.canEdit"
            @add-vertex="planner.addVertexToDraft"
            @select-entity="planner.selectEntity"
            @translate-entity="planner.translateEntity"
            @update-vertex="planner.updateVertex"
          />
        </section>

        <div class="inspector-shell">
          <InspectorPanel
            :current-template="planner.currentTemplate"
            :draft-vertices="planner.draftVertices"
            :firebase-enabled="auth.firebaseEnabled"
            :grid-unit="planner.project?.gridUnit ?? 'm'"
            :editable="planner.canEdit"
            :selected-entity="planner.selectedEntity"
            :status-message="planner.statusMessage"
            :sync-state="planner.syncState"
            :tool-mode="planner.toolMode"
            @cancel-draft="planner.cancelDraft"
            @commit-draft="planner.commitDraft"
            @delete-selected-entity="planner.deleteSelectedEntity"
            @update-selected-entity="planner.updateSelectedEntity"
            @update-selected-entity-vertex="(vertexIndex, axis, rawValue) => planner.updateSelectedEntityVertex(vertexIndex, axis, rawValue, planner.project?.gridUnit ?? 'm')"
          />
        </div>
      </main>
    </ion-content>
  </ion-page>
</template>
