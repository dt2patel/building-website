<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  entityCenter,
  formatCoordinate,
  getBounds,
  gridSpacingInMeters,
  pointsToPath,
  snapToGrid,
} from '../../lib/geometry'
import type {
  Floor,
  GridPoint,
  LayerType,
  Project,
  Template,
  ToolMode,
} from '../../types/planner'

const props = defineProps<{
  activeLayerType: LayerType
  draftVertices: GridPoint[]
  editable: boolean
  floor: Floor | undefined
  project: Project
  selectedEntityId: string | null
  toolMode: ToolMode
  visibleTemplates: Template[]
}>()

const emit = defineEmits<{
  addVertex: [point: GridPoint]
  selectEntity: [payload: { entityId: string | null; layerType?: LayerType }]
  updateVertex: [entityId: string, vertexIndex: number, point: GridPoint]
}>()

const svgRef = ref<SVGSVGElement | null>(null)
const dragState = ref<{ entityId: string; vertexIndex: number } | null>(null)
const hoverPoint = ref<GridPoint | null>(null)

const plotBounds = computed(() => getBounds(props.project.plotBoundary))
const viewBoxGeometry = computed(() => {
  const bounds = plotBounds.value
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const margin = Math.max(width, height) * 0.1

  return {
    minX: bounds.minX - margin,
    minY: bounds.minY - margin,
    width: width + margin * 2,
    height: height + margin * 2,
  }
})

const viewBox = computed(
  () =>
    `${viewBoxGeometry.value.minX} ${viewBoxGeometry.value.minY} ${viewBoxGeometry.value.width} ${viewBoxGeometry.value.height}`,
)
const plotPath = computed(() => pointsToPath(props.project.plotBoundary, true))

function pointerToGrid(event: PointerEvent | MouseEvent): GridPoint | null {
  const svg = svgRef.value
  if (!svg) {
    return null
  }

  const rect = svg.getBoundingClientRect()
  const geometry = viewBoxGeometry.value
  const rawX = ((event.clientX - rect.left) / rect.width) * geometry.width + geometry.minX
  const rawY = ((event.clientY - rect.top) / rect.height) * geometry.height + geometry.minY

  return snapToGrid({ x: rawX, y: rawY }, props.project.gridSpacing, props.project.gridUnit)
}

function handleCanvasClick(event: MouseEvent) {
  if (!props.editable || props.toolMode === 'select' || dragState.value) {
    return
  }

  const point = pointerToGrid(event)
  if (point) {
    emit('addVertex', point)
  }
}

function handleEntityClick(
  event: MouseEvent,
  entityId: string,
  layerType: LayerType,
) {
  if (props.toolMode !== 'select') {
    return
  }

  event.stopPropagation()
  emit('selectEntity', { entityId, layerType })
}

function beginVertexDrag(event: PointerEvent, entityId: string, vertexIndex: number) {
  if (!props.editable) {
    return
  }

  event.stopPropagation()
  dragState.value = { entityId, vertexIndex }
  ;(event.target as SVGCircleElement).setPointerCapture(event.pointerId)
}

function handlePointerMove(event: PointerEvent) {
  const point = pointerToGrid(event)
  hoverPoint.value = point

  if (!dragState.value || !point) {
    return
  }

  emit('updateVertex', dragState.value.entityId, dragState.value.vertexIndex, point)
}

function releaseDrag() {
  dragState.value = null
}

function clearHover() {
  hoverPoint.value = null
  releaseDrag()
}

onBeforeUnmount(() => {
  releaseDrag()
})

const allEntities = computed(() =>
  props.visibleTemplates.flatMap((template) =>
    template.entities.map((entity) => ({
      entity,
      template,
      isActiveLayer: template.layerType === props.activeLayerType,
    })),
  ),
)

const compass = computed(() => {
  const bounds = plotBounds.value
  return {
    north: { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY - 2.8 },
    south: { x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY + 3.6 },
    west: { x: bounds.minX - 2.5, y: (bounds.minY + bounds.maxY) / 2 },
    east: { x: bounds.maxX + 2.5, y: (bounds.minY + bounds.maxY) / 2 },
  }
})

const hoverLabel = computed(() => {
  if (!hoverPoint.value) {
    return 'Hover the plot to inspect coordinates'
  }

  return `X ${formatCoordinate(hoverPoint.value.x, props.project.gridUnit)} • Y ${formatCoordinate(
    hoverPoint.value.y,
    props.project.gridUnit,
  )}`
})

defineExpose({
  getSvgElement: () => svgRef.value,
})
</script>

<template>
  <div class="editor-stage">
    <header class="editor-stage__header">
      <div>
        <p class="eyebrow">Live floor canvas</p>
        <h2>{{ floor?.name ?? 'No floor selected' }}</h2>
      </div>
      <div class="editor-stage__meta">
        <p class="editor-stage__hint">
          Plot on a snapped {{ project.gridSpacing }} {{ project.gridUnit }} grid with plot-based coordinates.
        </p>
        <p v-if="!editable" class="editor-stage__hint editor-stage__hint--readonly">
          Canvas editing is locked until Firestore confirms a live server connection.
        </p>
        <p class="editor-stage__hover">{{ hoverLabel }}</p>
      </div>
    </header>

    <svg
      ref="svgRef"
      class="editor-canvas"
      :viewBox="viewBox"
      @click="handleCanvasClick"
      @pointermove="handlePointerMove"
      @pointerup="releaseDrag"
      @pointerleave="clearHover"
    >
      <defs>
        <pattern
          id="gridPattern"
          :width="gridSpacingInMeters(project.gridSpacing, project.gridUnit)"
          :height="gridSpacingInMeters(project.gridSpacing, project.gridUnit)"
          patternUnits="userSpaceOnUse"
        >
          <path
            :d="`M ${gridSpacingInMeters(project.gridSpacing, project.gridUnit)} 0 L 0 0 0 ${gridSpacingInMeters(project.gridSpacing, project.gridUnit)}`"
            fill="none"
            stroke="rgba(66, 86, 107, 0.16)"
            stroke-width="0.035"
          />
        </pattern>
      </defs>

      <rect
        :x="viewBoxGeometry.minX"
        :y="viewBoxGeometry.minY"
        :width="viewBoxGeometry.width"
        :height="viewBoxGeometry.height"
        fill="url(#gridPattern)"
      />
      <path :d="plotPath" class="boundary boundary--plot" />

      <text class="compass-label" :x="compass.north.x" :y="compass.north.y">N</text>
      <text class="compass-label" :x="compass.south.x" :y="compass.south.y">S</text>
      <text class="compass-label" :x="compass.west.x" :y="compass.west.y">W</text>
      <text class="compass-label" :x="compass.east.x" :y="compass.east.y">E</text>

      <g class="fixed-shell">
        <template v-for="structure in project.fixedStructures" :key="structure.id">
          <path :d="pointsToPath(structure.vertices, true)" class="fixed-structure" />
          <text
            class="entity-label entity-label--fixed"
            :x="entityCenter(structure).x"
            :y="entityCenter(structure).y"
          >
            {{ structure.label }}
          </text>
        </template>
      </g>

      <g v-for="{ entity, template, isActiveLayer } in allEntities" :key="entity.id" class="entity-layer">
        <path
          v-if="entity.geometryType === 'polygon'"
          :d="pointsToPath(entity.vertices, true)"
          class="shape"
          :class="{ 'shape--selected': selectedEntityId === entity.id }"
          :style="{
            stroke: entity.style.stroke,
            fill: entity.style.fill,
            strokeWidth: entity.style.strokeWidth,
            opacity: isActiveLayer ? entity.style.opacity : 0.46,
          }"
          @click="handleEntityClick($event, entity.id, template.layerType)"
        />
        <path
          v-else-if="entity.geometryType === 'polyline'"
          :d="pointsToPath(entity.vertices)"
          class="shape shape--polyline"
          :class="{ 'shape--selected': selectedEntityId === entity.id }"
          :style="{
            stroke: entity.style.stroke,
            fill: 'none',
            strokeWidth: entity.style.strokeWidth,
            opacity: isActiveLayer ? entity.style.opacity : 0.46,
            strokeDasharray: entity.style.dashed ? '2 1.4' : 'none',
          }"
          @click="handleEntityClick($event, entity.id, template.layerType)"
        />
        <g
          v-else
          class="point-symbol"
          @click="handleEntityClick($event, entity.id, template.layerType)"
        >
          <circle
            :cx="entity.vertices[0].x"
            :cy="entity.vertices[0].y"
            r="0.22"
            :class="{ 'shape--selected': selectedEntityId === entity.id }"
            :style="{ stroke: entity.style.stroke, fill: entity.style.fill }"
          />
          <path
            :d="`M ${entity.vertices[0].x - 0.34} ${entity.vertices[0].y} L ${entity.vertices[0].x + 0.34} ${entity.vertices[0].y} M ${entity.vertices[0].x} ${entity.vertices[0].y - 0.34} L ${entity.vertices[0].x} ${entity.vertices[0].y + 0.34}`"
            class="point-cross"
            :style="{ stroke: entity.style.stroke }"
          />
        </g>

        <text
          v-if="template.layerType === 'perimeter' || selectedEntityId === entity.id"
          class="entity-label"
          :class="{ 'entity-label--active': template.layerType === activeLayerType }"
          :x="entityCenter(entity).x + 0.55"
          :y="entityCenter(entity).y - 0.45"
        >
          {{ entity.label }}
        </text>

        <g v-if="selectedEntityId === entity.id">
          <circle
            v-for="(vertex, vertexIndex) in entity.vertices"
            :key="`${entity.id}-${vertexIndex}`"
            class="vertex-handle"
            :cx="vertex.x"
            :cy="vertex.y"
            r="0.38"
            @pointerdown="beginVertexDrag($event, entity.id, vertexIndex)"
          />
        </g>
      </g>

      <g v-if="draftVertices.length" class="draft-layer">
        <path
          :d="pointsToPath(draftVertices, toolMode === 'polygon' && draftVertices.length > 2)"
          class="draft-shape"
        />
        <circle
          v-for="(vertex, index) in draftVertices"
          :key="`draft-${index}`"
          class="vertex-handle"
          :cx="vertex.x"
          :cy="vertex.y"
          r="0.28"
        />
      </g>
    </svg>
  </div>
</template>
