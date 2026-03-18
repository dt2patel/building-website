<script setup lang="ts">
import { IonContent, IonPage, onIonViewWillEnter, onIonViewWillLeave } from '@ionic/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DesignCanvas from '../components/canvas/DesignCanvas.vue'
import type { CanvasEntityPresentation, ViewBoxGeometry } from '../components/canvas/designCanvas'
import ExteriorInspectorPanel from '../components/exterior/ExteriorInspectorPanel.vue'
import WholeBuildingElevation from '../components/exterior/WholeBuildingElevation.vue'
import { clampToRange, snapToGrid, toDisplayValue } from '../lib/geometry'
import { useAuthStore } from '../stores/authStore'
import { useExteriorPlannerStore } from '../stores/exteriorPlannerStore'
import { useProjectsStore } from '../stores/projectsStore'
import { sideLabel } from '../lib/plannerModel'
import type { GridPoint } from '../types/planner'
import { layerLabels, layerOrder, type CardinalSide, type LayerType, type MeasurementUnit, type ToolMode } from '../types/planner'

const auth = useAuthStore()
const exterior = useExteriorPlannerStore()
const projectsStore = useProjectsStore()
const route = useRoute()
const router = useRouter()
const toolModes: ToolMode[] = ['select', 'point', 'polyline', 'polygon']
const sides: CardinalSide[] = ['east', 'west', 'north', 'south']
let keydownListenerAttached = false
const visibleGuideLayers = ref<LayerType[]>([])

const projectAccess = computed(() =>
  [...projectsStore.projects, ...projectsStore.archivedProjects]
    .find((project) => project.id === String(route.params.projectId)),
)
const exteriorCanvasPadding = {
  horizontal: 1,
  top: 1.25,
  bottom: 0.75,
}

const exteriorViewBoxGeometry = computed<ViewBoxGeometry>(() => {
  const width = Math.max(exterior.facadeProjection?.width ?? 10, 10)
  const height = Math.max(exterior.facadeProjection?.height ?? 3, 3)

  return {
    minX: -exteriorCanvasPadding.horizontal,
    minY: -exteriorCanvasPadding.top,
    width: width + exteriorCanvasPadding.horizontal * 2,
    height: height + exteriorCanvasPadding.top + exteriorCanvasPadding.bottom,
  }
})

const exteriorGrid = computed(() =>
  exterior.project && exterior.facadeProjection
    ? {
        spacing: exterior.project.gridSpacing,
        unit: exterior.project.gridUnit,
        rect: {
          x: 0,
          y: 0,
          width: exterior.facadeProjection.width,
          height: exterior.facadeProjection.height,
        },
      }
    : undefined,
)

const exteriorEntities = computed<CanvasEntityPresentation[]>(() =>
  (exterior.currentTemplate?.entities ?? []).map((entity) => ({
    entity,
    showLabel: true,
  })),
)

const availableGuideLayers = computed(() =>
  Array.from(
    new Set(
      (exterior.facadeProjection?.guides ?? [])
        .map((guide) => guide.layerType),
    ),
  ).sort((left, right) => layerOrder.indexOf(left) - layerOrder.indexOf(right)) as LayerType[],
)

const visibleFacadeGuides = computed(() =>
  (exterior.facadeProjection?.guides ?? []).filter((guide) =>
    visibleGuideLayers.value.includes(guide.layerType),
  ),
)

function exteriorScreenToWorld(
  event: PointerEvent | MouseEvent,
  svg: SVGSVGElement,
  geometry: ViewBoxGeometry,
): GridPoint | null {
  if (!exterior.facadeProjection || !exterior.project) {
    return null
  }

  const rect = svg.getBoundingClientRect()
  const rawX = ((event.clientX - rect.left) / rect.width) * geometry.width + geometry.minX
  const rawY = ((event.clientY - rect.top) / rect.height) * geometry.height + geometry.minY
  const clampedPoint = {
    x: clampToRange(rawX, 0, exterior.facadeProjection.width),
    y: clampToRange(exterior.facadeProjection.height - rawY, 0, exterior.facadeProjection.height),
  }
  const snapped = snapToGrid(
    clampedPoint,
    exterior.project.gridSpacing,
    exterior.project.gridUnit,
  )

  return {
    x: clampToRange(snapped.x, 0, exterior.facadeProjection.width),
    y: clampToRange(snapped.y, 0, exterior.facadeProjection.height),
  }
}

function exteriorWorldToSvg(point: GridPoint): GridPoint {
  return {
    x: point.x,
    y: (exterior.facadeProjection?.height ?? 0) - point.y,
  }
}

function guideLabelAnchorX(horizontalStart: number, horizontalEnd: number) {
  if (horizontalStart === horizontalEnd) {
    return horizontalStart + 0.28
  }

  return (horizontalStart + horizontalEnd) / 2 + 0.22
}

function guideLabelAnchorY(index: number) {
  return -0.22 - (index % 3) * 0.3
}

function guideLabelTransform(horizontalStart: number, horizontalEnd: number, index: number) {
  const x = guideLabelAnchorX(horizontalStart, horizontalEnd)
  const y = guideLabelAnchorY(index)
  return `rotate(-45 ${x} ${y})`
}

function showAllGuideLayers() {
  visibleGuideLayers.value = [...availableGuideLayers.value]
}

function toggleGuideLayer(layerType: LayerType) {
  visibleGuideLayers.value = visibleGuideLayers.value.includes(layerType)
    ? visibleGuideLayers.value.filter((value) => value !== layerType)
    : [...visibleGuideLayers.value, layerType]
}

function isGuideLayerVisible(layerType: LayerType) {
  return visibleGuideLayers.value.includes(layerType)
}

function guideLayerLabel(layerType: LayerType) {
  return layerLabels[layerType]
}

function floorHeightDisplayValue() {
  const floor = exterior.selectedFloor
  const unit = exterior.project?.gridUnit ?? 'm'
  return floor ? toDisplayValue(floor.heightMeters, unit) : 0
}

function updateGridUnit(event: Event) {
  const nextUnit = (event.target as HTMLSelectElement).value as MeasurementUnit
  if (!exterior.project) {
    return
  }

  exterior.updateGridSettings(nextUnit, exterior.project.gridSpacing)
}

function updateGridSpacing(event: Event) {
  if (!exterior.project) {
    return
  }

  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isNaN(value) && value > 0) {
    exterior.updateGridSettings(exterior.project.gridUnit, value)
  }
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

  if (isFormField || !exterior.selectedEntity || !exterior.canEdit) {
    return
  }

  event.preventDefault()
  exterior.deleteSelectedEntity()
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

  try {
    await exterior.initialize({
      projectId,
      saveId,
      canEdit: access.canEdit,
    })
  } catch (error) {
    if (saveId !== access.defaultSaveId) {
      await router.replace({
        name: 'project-exterior-editor',
        params: {
          projectId,
          saveId: access.defaultSaveId,
        },
      })
      return
    }

    exterior.statusMessage = error instanceof Error ? error.message : 'Unable to load exterior planner.'
  }
}

function updateFloorHeight(event: Event) {
  if (!exterior.project) {
    return
  }

  exterior.updateFloorHeight(
    Number((event.target as HTMLInputElement).value),
    exterior.project.gridUnit,
  )
}

function openBuildingFloor(floorId: string) {
  exterior.selectFloor(floorId)
  exterior.setActiveView('floor')
}

onIonViewWillEnter(async () => {
  await hydrateEditor()
  attachKeydownListener()
})

onIonViewWillLeave(() => {
  detachKeydownListener()
  exterior.cleanup()
})

watch(
  () => [route.params.projectId, route.params.saveId, projectAccess.value?.canEdit],
  async () => {
    await hydrateEditor()
  },
)

watch(
  availableGuideLayers,
  (layers) => {
    const retainedLayers = visibleGuideLayers.value.filter((layer) => layers.includes(layer))
    visibleGuideLayers.value = retainedLayers.length === layers.length ? retainedLayers : [...layers]
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  detachKeydownListener()
  exterior.cleanup()
})
</script>

<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="workspace">
        <aside class="sidebar">
          <div class="panel-card panel-card--hero">
            <p class="eyebrow">Blueprint Planner</p>
            <h1>{{ exterior.projectMeta?.name ?? exterior.project?.name ?? 'Project' }}</h1>
            <p>
              Active save:
              <strong>{{ exterior.availableSaves.find((save) => save.id === exterior.activeSaveId)?.name ?? exterior.activeSaveId }}</strong>
            </p>
          </div>

          <section class="panel-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Navigation</p>
                <h2>Project views</h2>
              </div>
            </div>

            <div class="button-row button-row--wrap">
              <button class="button button--ghost" @click="router.push({ name: 'projects' })">Dashboard</button>
              <button
                class="button button--ghost"
                @click="router.push({ name: 'project-editor', params: { projectId: route.params.projectId, saveId: route.params.saveId } })"
              >
                Floor planner
              </button>
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
                v-for="floor in exterior.project?.floors ?? []"
                :key="floor.id"
                class="pill-button"
                :class="{ 'pill-button--active': exterior.selectedFloorId === floor.id }"
                @click="exterior.selectFloor(floor.id)"
              >
                {{ floor.name }}
              </button>
            </div>
          </section>

          <section class="panel-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Facade Side</p>
                <h2>Choose an elevation</h2>
              </div>
            </div>

            <div class="pill-grid">
              <button
                v-for="side in sides"
                :key="side"
                class="pill-button"
                :class="{ 'pill-button--active': exterior.selectedSide === side }"
                @click="exterior.selectSide(side)"
              >
                {{ sideLabel(side) }}
              </button>
            </div>
          </section>

          <section class="panel-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Project Geometry</p>
                <h2>Grid settings</h2>
              </div>
            </div>

            <div class="field-grid">
              <label class="field">
                <span>Grid unit</span>
                <select
                  name="grid-unit"
                  :value="exterior.project?.gridUnit ?? 'm'"
                  :disabled="!exterior.canEdit"
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
                  :value="exterior.project?.gridSpacing ?? 1"
                  :disabled="!exterior.canEdit"
                  @change="updateGridSpacing"
                />
              </label>
            </div>
          </section>

          <section class="panel-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Floor Height</p>
                <h2>Facade fit</h2>
              </div>
            </div>

            <label class="field">
              <span>Height ({{ exterior.project?.gridUnit ?? 'm' }})</span>
              <input
                type="number"
                min="0.1"
                step="0.01"
                :disabled="!exterior.canEdit"
                :value="floorHeightDisplayValue()"
                @change="updateFloorHeight"
              />
            </label>
          </section>

          <section class="panel-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Exterior Template</p>
                <h2>Side assignment</h2>
              </div>
            </div>

            <label class="field">
              <span>{{ sideLabel(exterior.selectedSide) }} template</span>
              <select
                :disabled="!exterior.canEdit"
                :value="exterior.currentTemplateId ?? ''"
                @change="exterior.assignTemplate(($event.target as HTMLSelectElement).value || null)"
              >
                <option value="">No template assigned</option>
                <option v-for="template in exterior.filteredTemplates" :key="template.id" :value="template.id">
                  {{ template.name }}
                </option>
              </select>
            </label>

            <div class="button-row">
              <button class="button button--ghost" :disabled="!exterior.canEdit" @click="exterior.createTemplate()">New</button>
              <button class="button button--ghost" :disabled="!exterior.canEdit || !exterior.currentTemplate" @click="exterior.cloneCurrentTemplate()">
                Clone
              </button>
            </div>
          </section>
        </aside>

        <section class="canvas-shell">
          <div class="toolbar">
            <div class="toolbar__group">
              <button
                class="tool-button"
                :class="{ 'tool-button--active': exterior.activeView === 'floor' }"
                @click="exterior.setActiveView('floor')"
              >
                Floor Side View
              </button>
              <button
                class="tool-button"
                :class="{ 'tool-button--active': exterior.activeView === 'building' }"
                @click="exterior.setActiveView('building')"
              >
                Whole Building
              </button>
              <button
                v-for="tool in toolModes"
                :key="tool"
                class="tool-button"
                :class="{ 'tool-button--active': exterior.toolMode === tool }"
                :disabled="exterior.activeView !== 'floor' || (tool !== 'select' && !exterior.canEdit)"
                @click="exterior.setToolMode(tool)"
              >
                {{ tool }}
              </button>
            </div>

            <div
              v-if="exterior.activeView === 'floor' && availableGuideLayers.length"
              class="toolbar__group toolbar__group--filters"
            >
              <span class="toolbar__notice">Guide layers</span>
              <button
                class="pill-button pill-button--compact"
                :class="{ 'pill-button--active': visibleGuideLayers.length === availableGuideLayers.length }"
                @click="showAllGuideLayers"
              >
                All
              </button>
              <button
                v-for="layerType in availableGuideLayers"
                :key="layerType"
                class="pill-button pill-button--compact"
                :class="{ 'pill-button--active': isGuideLayerVisible(layerType) }"
                @click="toggleGuideLayer(layerType)"
              >
                {{ guideLayerLabel(layerType) }}
              </button>
            </div>

            <div class="toolbar__group toolbar__group--meta">
              <span class="status-pill" :class="`status-pill--${exterior.syncState}`">{{ exterior.syncState }}</span>
              <button class="button button--ghost" @click="exterior.persist()">Sync now</button>
            </div>
          </div>

          <DesignCanvas
            v-if="exterior.activeView === 'floor'"
            header-eyebrow="Exterior elevation canvas"
            :header-title="exterior.facadeProjection ? `${sideLabel(exterior.facadeProjection.side)} side` : 'No side selected'"
            :header-hint="exterior.project ? `Draw facade geometry against projected wall guides on a snapped ${exterior.project.gridSpacing} ${exterior.project.gridUnit} grid.` : undefined"
            readonly-hint="Canvas editing is locked until Firestore confirms a live server connection."
            hover-empty-label="Hover the elevation to inspect coordinates"
            :draft-style="exterior.draftStyle"
            :draft-vertices="exterior.draftVertices"
            :editable="exterior.canEdit"
            :view-box-geometry="exteriorViewBoxGeometry"
            :grid="exteriorGrid"
            :entities="exteriorEntities"
            :selected-entity-id="exterior.selectedEntityId"
            :tool-mode="exterior.toolMode"
            :screen-to-world="exteriorScreenToWorld"
            :world-to-svg="exteriorWorldToSvg"
            @add-vertex="exterior.addVertexToDraft"
            @select-entity="({ entityId }) => exterior.selectEntity(entityId)"
            @translate-entity="exterior.translateEntity"
            @update-vertex="exterior.updateVertex"
          >
            <template #underlay>
              <g v-if="exterior.facadeProjection">
                <rect
                  x="0"
                  y="0"
                  :width="exterior.facadeProjection.width"
                  :height="exterior.facadeProjection.height"
                  fill="none"
                  stroke="rgba(22, 33, 43, 0.16)"
                  stroke-width="0.08"
                />

                <g v-for="(guide, guideIndex) in visibleFacadeGuides" :key="guide.id">
                  <template v-if="guide.kind === 'column' || guide.horizontalStart === guide.horizontalEnd">
                    <line
                      :x1="guide.horizontalStart"
                      y1="0"
                      :x2="guide.horizontalStart"
                      :y2="exterior.facadeProjection.height"
                      class="facade-guide-line facade-guide-line--column"
                    />
                    <circle
                      :cx="guide.horizontalStart"
                      cy="0"
                      r="0.15"
                      class="facade-guide-marker"
                    />
                  </template>
                  <template v-else>
                    <line
                      :x1="guide.horizontalStart"
                      y1="0.16"
                      :x2="guide.horizontalEnd"
                      y2="0.16"
                      class="facade-guide-line facade-guide-line--span"
                    />
                    <line
                      :x1="guide.horizontalStart"
                      y1="0"
                      :x2="guide.horizontalStart"
                      :y2="exterior.facadeProjection.height"
                      class="facade-guide-line facade-guide-line--feature"
                    />
                    <line
                      :x1="guide.horizontalEnd"
                      y1="0"
                      :x2="guide.horizontalEnd"
                      :y2="exterior.facadeProjection.height"
                      class="facade-guide-line facade-guide-line--feature"
                    />
                  </template>
                  <text
                    class="entity-label facade-guide-label"
                    :class="
                      guide.kind === 'column' || guide.horizontalStart === guide.horizontalEnd
                        ? 'facade-guide-label--column'
                        : 'facade-guide-label--feature'
                    "
                    :x="guideLabelAnchorX(guide.horizontalStart, guide.horizontalEnd)"
                    :y="guideLabelAnchorY(guideIndex)"
                    :transform="guideLabelTransform(guide.horizontalStart, guide.horizontalEnd, guideIndex)"
                  >
                    {{ guide.label }}
                  </text>
                </g>
              </g>
            </template>
          </DesignCanvas>

          <WholeBuildingElevation
            v-else
            :building-height="exterior.buildingHeight"
            :floors="exterior.stackedFloors"
            @open-floor="openBuildingFloor"
          />
        </section>

        <div class="inspector-shell">
          <ExteriorInspectorPanel
            :current-template="exterior.currentTemplate"
            :draft-vertices="exterior.draftVertices"
            :firebase-enabled="auth.firebaseEnabled"
            :grid-unit="exterior.project?.gridUnit ?? 'm'"
            :editable="exterior.canEdit"
            :selected-entity="exterior.selectedEntity"
            :status-message="exterior.statusMessage"
            :sync-state="exterior.syncState"
            :tool-mode="exterior.toolMode"
            @cancel-draft="exterior.cancelDraft"
            @commit-draft="exterior.commitDraft"
            @delete-selected-entity="exterior.deleteSelectedEntity"
            @update-selected-entity="exterior.updateSelectedEntity"
            @update-selected-entity-vertex="(vertexIndex, axis, rawValue) => exterior.updateSelectedEntityVertex(vertexIndex, axis, rawValue, exterior.project?.gridUnit ?? 'm')"
          />
        </div>
      </main>
    </ion-content>
  </ion-page>
</template>
