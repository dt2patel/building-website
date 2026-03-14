<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { entityCenter, pointsToPath, snapToGrid } from '../../lib/geometry'
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
  floor: Floor | undefined
  project: Project
  selectedEntityId: string | null
  toolMode: ToolMode
  visibleTemplates: Template[]
}>()

const emit = defineEmits<{
  addVertex: [point: GridPoint]
  selectEntity: [entityId: string | null]
  updateVertex: [entityId: string, vertexIndex: number, point: GridPoint]
}>()

const svgRef = ref<SVGSVGElement | null>(null)
const dragState = ref<{ entityId: string; vertexIndex: number } | null>(null)

const viewBox = computed(() => `-4 -4 128 98`)
const plotPath = computed(() => pointsToPath(props.project.plotBoundary, true))
const buildingPath = computed(() => pointsToPath(props.project.buildingBoundary, true))

function pointerToGrid(event: PointerEvent | MouseEvent): GridPoint | null {
  const svg = svgRef.value
  if (!svg) {
    return null
  }

  const rect = svg.getBoundingClientRect()
  const rawX = ((event.clientX - rect.left) / rect.width) * 128 - 4
  const rawY = ((event.clientY - rect.top) / rect.height) * 98 - 4
  return snapToGrid({ x: rawX, y: rawY }, props.project.gridSpacing)
}

function handleCanvasClick(event: MouseEvent) {
  if (props.toolMode === 'select' || dragState.value) {
    return
  }

  const point = pointerToGrid(event)
  if (point) {
    emit('addVertex', point)
  }
}

function beginVertexDrag(event: PointerEvent, entityId: string, vertexIndex: number) {
  event.stopPropagation()
  dragState.value = { entityId, vertexIndex }
  ;(event.target as SVGCircleElement).setPointerCapture(event.pointerId)
}

function handlePointerMove(event: PointerEvent) {
  if (!dragState.value) {
    return
  }

  const point = pointerToGrid(event)
  if (point) {
    emit('updateVertex', dragState.value.entityId, dragState.value.vertexIndex, point)
  }
}

function releaseDrag() {
  dragState.value = null
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
      <p class="editor-stage__hint">
        Plot on a snapped {{ project.gridSpacing }} {{ project.units }} grid. Fixed cores stay read-only.
      </p>
    </header>

    <svg
      ref="svgRef"
      class="editor-canvas"
      :viewBox="viewBox"
      @click="handleCanvasClick"
      @pointermove="handlePointerMove"
      @pointerup="releaseDrag"
      @pointerleave="releaseDrag"
    >
      <defs>
        <pattern id="gridPattern" :width="project.gridSpacing" :height="project.gridSpacing" patternUnits="userSpaceOnUse">
          <path
            :d="`M ${project.gridSpacing} 0 L 0 0 0 ${project.gridSpacing}`"
            fill="none"
            stroke="rgba(66, 86, 107, 0.16)"
            stroke-width="0.14"
          />
        </pattern>
      </defs>

      <rect x="-4" y="-4" width="128" height="98" fill="url(#gridPattern)" />
      <path :d="plotPath" class="boundary boundary--plot" />
      <path :d="buildingPath" class="boundary boundary--building" />

      <g class="fixed-shell">
        <template v-for="structure in project.fixedStructures" :key="structure.id">
          <path
            :d="pointsToPath(structure.vertices, true)"
            class="fixed-structure"
          />
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
          @click.stop="emit('selectEntity', entity.id)"
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
          @click.stop="emit('selectEntity', entity.id)"
        />
        <g
          v-else
          class="point-symbol"
          @click.stop="emit('selectEntity', entity.id)"
        >
          <circle
            :cx="entity.vertices[0].x"
            :cy="entity.vertices[0].y"
            r="1.2"
            :class="{ 'shape--selected': selectedEntityId === entity.id }"
            :style="{ stroke: entity.style.stroke, fill: entity.style.fill }"
          />
          <path
            :d="`M ${entity.vertices[0].x - 1.6} ${entity.vertices[0].y} L ${entity.vertices[0].x + 1.6} ${entity.vertices[0].y} M ${entity.vertices[0].x} ${entity.vertices[0].y - 1.6} L ${entity.vertices[0].x} ${entity.vertices[0].y + 1.6}`"
            class="point-cross"
            :style="{ stroke: entity.style.stroke }"
          />
        </g>

        <text
          class="entity-label"
          :class="{ 'entity-label--active': template.layerType === activeLayerType }"
          :x="entityCenter(entity).x + 1.6"
          :y="entityCenter(entity).y - 1.3"
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
            r="1.2"
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
          r="0.9"
        />
      </g>
    </svg>
  </div>
</template>
