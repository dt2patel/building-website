<script setup lang="ts">
import {
  IonContent,
  IonPage,
} from '@ionic/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import EditorCanvas from '../components/planner/EditorCanvas.vue'
import InspectorPanel from '../components/planner/InspectorPanel.vue'
import { toDisplayValue } from '../lib/geometry'
import { isFirebaseConfigured } from '../services/firebase'
import { usePlannerStore } from '../stores/plannerStore'
import { layerLabels, layerOrder, type MeasurementUnit, type ToolMode } from '../types/planner'

const planner = usePlannerStore()
const firebaseEnabled = isFirebaseConfigured()
const editorCanvas = ref<InstanceType<typeof EditorCanvas> | null>(null)
const toolModes: ToolMode[] = ['select', 'point', 'polyline', 'polygon']

onMounted(async () => {
  await planner.initialize()
  window.addEventListener('keydown', handleGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  planner.cleanup()
})

const activeLayerTemplates = computed(
  () => planner.templatesByLayer[planner.activeLayerType],
)

function plotVertexValue(index: number, axis: 'x' | 'y') {
  const vertex = planner.project.plotBoundary[index]
  return vertex ? toDisplayValue(vertex[axis], planner.project.gridUnit) : 0
}

function updateGridUnit(event: Event) {
  const nextUnit = (event.target as HTMLSelectElement).value as MeasurementUnit
  planner.updateGridSettings(nextUnit, planner.project.gridSpacing)
}

function updateGridSpacing(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isNaN(value) && value > 0) {
    planner.updateGridSettings(planner.project.gridUnit, value)
  }
}

function updatePlotVertex(index: number, axis: 'x' | 'y', event: Event) {
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
</script>

<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="workspace">
        <aside class="sidebar">
          <div class="panel-card panel-card--hero">
            <p class="eyebrow">Blueprint Planner</p>
            <h1>{{ planner.project.name }}</h1>
            <p>
              Grid-first engineering sketchbook for live-linked floor templates and quick PDF exports.
            </p>
          </div>

          <section class="panel-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Floors</p>
                <h2>Choose a floor</h2>
              </div>
            </div>

            <div class="pill-grid">
              <button
                v-for="floor in planner.project.floors"
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
                  :value="planner.project.gridUnit"
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
                  :value="planner.project.gridSpacing"
                  :disabled="!planner.canEdit"
                  @change="updateGridSpacing"
                />
              </label>
            </div>

            <div class="plot-vertex-grid">
              <label
                v-for="(_, index) in planner.project.plotBoundary"
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
                <small>{{ planner.project.gridUnit === 'm' ? 'x / y in meters' : 'x / y in centimeters' }}</small>
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
                <h2>Live-linked layer source</h2>
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
              <p v-if="!planner.canEdit" class="toolbar__notice">Read-only until a live Firestore session is verified.</p>
              <button class="button button--ghost" :disabled="!firebaseEnabled" @click="planner.persist()">Sync now</button>
              <button class="button button--primary" @click="exportCurrentFloor">Export PDF</button>
            </div>
          </div>

          <EditorCanvas
            ref="editorCanvas"
            :active-layer-type="planner.activeLayerType"
            :draft-vertices="planner.draftVertices"
            :floor="planner.selectedFloor"
            :project="planner.project"
            :selected-entity-id="planner.selectedEntityId"
            :tool-mode="planner.toolMode"
            :visible-templates="planner.visibleTemplates"
            :editable="planner.canEdit"
            @add-vertex="planner.addVertexToDraft"
            @select-entity="planner.selectEntity"
            @update-vertex="planner.updateVertex"
          />
        </section>

        <InspectorPanel
          :current-template="planner.currentTemplate"
          :draft-vertices="planner.draftVertices"
          :firebase-enabled="firebaseEnabled"
          :grid-unit="planner.project.gridUnit"
          :editable="planner.canEdit"
          :selected-entity="planner.selectedEntity"
          :status-message="planner.statusMessage"
          :sync-state="planner.syncState"
          :tool-mode="planner.toolMode"
          @cancel-draft="planner.cancelDraft"
          @commit-draft="planner.commitDraft"
          @delete-selected-entity="planner.deleteSelectedEntity"
          @update-selected-entity="planner.updateSelectedEntity"
          @update-selected-entity-vertex="(vertexIndex, axis, rawValue) => planner.updateSelectedEntityVertex(vertexIndex, axis, rawValue, planner.project.gridUnit)"
        />
      </main>
    </ion-content>
  </ion-page>
</template>
