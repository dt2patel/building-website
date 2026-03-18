<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  entityCenter,
  formatCoordinate,
  gridSpacingInMeters,
  pointsToPath,
} from '../../lib/geometry'
import type { GridPoint, LayerType } from '../../types/planner'
import type { DesignCanvasProps } from './designCanvas'

const props = defineProps<DesignCanvasProps>()

const emit = defineEmits<{
  addVertex: [point: GridPoint]
  selectEntity: [payload: { entityId: string | null; layerType?: LayerType }]
  translateEntity: [entityId: string, delta: GridPoint]
  updateVertex: [entityId: string, vertexIndex: number, point: GridPoint]
}>()

type DragState =
  | { kind: 'vertex'; entityId: string; vertexIndex: number }
  | { kind: 'entity'; entityId: string; lastPoint: GridPoint }
  | { kind: 'pan'; lastClientX: number; lastClientY: number }

interface TransformedEntityPresentation {
  dimmed?: boolean
  labelClass?: string | string[] | Record<string, boolean>
  labelPosition: GridPoint
  opacity: number
  selectionLayerType?: LayerType
  showLabel?: boolean
  svgVertices: GridPoint[]
  entity: DesignCanvasProps['entities'][number]['entity']
}

const defaultLabelOffset: GridPoint = { x: 0.55, y: -0.45 }
const minZoom = 1
const maxZoom = 6
const zoomStep = 0.5

let patternIdSeed = 0

const svgRef = ref<SVGSVGElement | null>(null)
const dragState = ref<DragState | null>(null)
const hoverPoint = ref<GridPoint | null>(null)
const suppressClick = ref(false)
const zoomLevel = ref(1)
const panMode = ref(false)
const panOffset = ref<GridPoint>({ x: 0, y: 0 })
const gridPatternId = `design-canvas-grid-${patternIdSeed += 1}`

const currentViewBoxGeometry = computed(() => {
  const width = props.viewBoxGeometry.width / zoomLevel.value
  const height = props.viewBoxGeometry.height / zoomLevel.value
  const defaultCenterX = props.viewBoxGeometry.minX + props.viewBoxGeometry.width / 2
  const defaultCenterY = props.viewBoxGeometry.minY + props.viewBoxGeometry.height / 2
  const horizontalPanLimit = Math.max(0, (props.viewBoxGeometry.width - width) / 2)
  const verticalPanLimit = Math.max(0, (props.viewBoxGeometry.height - height) / 2)
  const centerX = defaultCenterX + Math.min(Math.max(panOffset.value.x, -horizontalPanLimit), horizontalPanLimit)
  const centerY = defaultCenterY + Math.min(Math.max(panOffset.value.y, -verticalPanLimit), verticalPanLimit)

  return {
    minX: centerX - width / 2,
    minY: centerY - height / 2,
    width,
    height,
  }
})

const viewBox = computed(
  () =>
    `${currentViewBoxGeometry.value.minX} ${currentViewBoxGeometry.value.minY} ${currentViewBoxGeometry.value.width} ${currentViewBoxGeometry.value.height}`,
)
const zoomLabel = computed(() => `${Math.round(zoomLevel.value * 100)}%`)

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor
}

const gridPatternOrigin = computed(() => {
  if (!props.grid) {
    return { x: 0, y: 0 }
  }

  const spacing = gridSpacingInMeters(props.grid.spacing, props.grid.unit)
  if (spacing === 0) {
    return { x: 0, y: 0 }
  }

  const origin = props.worldToSvg({ x: 0, y: 0 })

  return {
    x: positiveModulo(origin.x, spacing),
    y: positiveModulo(origin.y, spacing),
  }
})

const transformedEntities = computed<TransformedEntityPresentation[]>(() =>
  props.entities.map((presentation) => {
    const labelOffset = presentation.labelOffset ?? defaultLabelOffset
    const labelAnchor = props.worldToSvg(entityCenter(presentation.entity))

    return {
      ...presentation,
      svgVertices: presentation.entity.vertices.map((vertex) => props.worldToSvg(vertex)),
      labelPosition: {
        x: labelAnchor.x + labelOffset.x,
        y: labelAnchor.y + labelOffset.y,
      },
      opacity: presentation.dimmed ? 0.46 : presentation.entity.style.opacity,
    }
  }),
)

const draftSvgVertices = computed(() =>
  props.draftVertices.map((vertex) => props.worldToSvg(vertex)),
)

const hoverLabel = computed(() => {
  if (!hoverPoint.value || !props.grid) {
    return props.hoverEmptyLabel
  }

  return `X ${formatCoordinate(hoverPoint.value.x, props.grid.unit)} • Y ${formatCoordinate(
    hoverPoint.value.y,
    props.grid.unit,
  )}`
})

function pointerToWorld(event: PointerEvent | MouseEvent): GridPoint | null {
  const svg = svgRef.value
  if (!svg) {
    return null
  }

  return props.screenToWorld(event, svg, currentViewBoxGeometry.value)
}

function handleCanvasClick(event: MouseEvent) {
  if (panMode.value || !props.editable || props.toolMode === 'select' || dragState.value) {
    return
  }

  const point = pointerToWorld(event)
  if (point) {
    emit('addVertex', point)
  }
}

function handleEntityClick(
  event: MouseEvent,
  entityId: string,
  layerType?: LayerType,
) {
  if (panMode.value || props.toolMode !== 'select' || suppressClick.value) {
    suppressClick.value = false
    return
  }

  event.stopPropagation()
  emit('selectEntity', { entityId, layerType })
}

function beginVertexDrag(event: PointerEvent, entityId: string, vertexIndex: number) {
  if (panMode.value || !props.editable) {
    return
  }

  event.stopPropagation()
  dragState.value = { kind: 'vertex', entityId, vertexIndex }
  ;(event.target as SVGCircleElement).setPointerCapture(event.pointerId)
}

function beginEntityDrag(event: PointerEvent, entityId: string) {
  if (panMode.value || !props.editable || props.toolMode !== 'select') {
    return
  }

  const point = pointerToWorld(event)
  if (!point) {
    return
  }

  event.stopPropagation()
  dragState.value = { kind: 'entity', entityId, lastPoint: point }
  ;(event.target as SVGPathElement).setPointerCapture(event.pointerId)
}

function beginPan(event: PointerEvent) {
  const svg = svgRef.value
  if (!svg || !panMode.value || zoomLevel.value <= minZoom) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
  dragState.value = {
    kind: 'pan',
    lastClientX: event.clientX,
    lastClientY: event.clientY,
  }
  svg.setPointerCapture(event.pointerId)
}

function handlePointerMove(event: PointerEvent) {
  const point = pointerToWorld(event)
  hoverPoint.value = point

  if (!dragState.value || !point) {
    return
  }

  if (dragState.value.kind === 'pan') {
    const svg = svgRef.value
    if (!svg) {
      return
    }

    const rect = svg.getBoundingClientRect()
    const deltaX =
      ((event.clientX - dragState.value.lastClientX) / rect.width) * currentViewBoxGeometry.value.width
    const deltaY =
      ((event.clientY - dragState.value.lastClientY) / rect.height) * currentViewBoxGeometry.value.height

    dragState.value.lastClientX = event.clientX
    dragState.value.lastClientY = event.clientY
    panOffset.value = {
      x: panOffset.value.x - deltaX,
      y: panOffset.value.y - deltaY,
    }
    return
  }

  if (dragState.value.kind === 'vertex') {
    emit('updateVertex', dragState.value.entityId, dragState.value.vertexIndex, point)
    return
  }

  const delta = {
    x: point.x - dragState.value.lastPoint.x,
    y: point.y - dragState.value.lastPoint.y,
  }

  if (delta.x === 0 && delta.y === 0) {
    return
  }

  suppressClick.value = true
  dragState.value.lastPoint = point
  emit('translateEntity', dragState.value.entityId, delta)
}

function releaseDrag() {
  dragState.value = null
}

function clearHover() {
  hoverPoint.value = null
  releaseDrag()
}

function zoomIn() {
  zoomLevel.value = Math.min(maxZoom, zoomLevel.value + zoomStep)
}

function zoomOut() {
  zoomLevel.value = Math.max(minZoom, zoomLevel.value - zoomStep)
  if (zoomLevel.value <= minZoom) {
    panMode.value = false
    panOffset.value = { x: 0, y: 0 }
  }
}

function resetZoom() {
  zoomLevel.value = 1
  panMode.value = false
  panOffset.value = { x: 0, y: 0 }
}

function togglePanMode() {
  if (zoomLevel.value <= minZoom) {
    return
  }

  panMode.value = !panMode.value
}

onBeforeUnmount(() => {
  releaseDrag()
})

defineExpose({
  getSvgElement: () => svgRef.value,
})
</script>

<template>
  <div class="editor-stage">
    <header class="editor-stage__header">
      <div>
        <p class="eyebrow">{{ headerEyebrow }}</p>
        <h2>{{ headerTitle }}</h2>
      </div>
      <div class="editor-stage__meta">
        <p v-if="headerHint" class="editor-stage__hint">{{ headerHint }}</p>
        <p v-if="!editable && readonlyHint" class="editor-stage__hint editor-stage__hint--readonly">
          {{ readonlyHint }}
        </p>
        <div class="editor-stage__controls">
          <span class="editor-stage__zoom">{{ zoomLabel }}</span>
          <button
            class="button button--ghost editor-stage__pan-toggle"
            :class="{ 'editor-stage__zoom-toggle--active': panMode }"
            :disabled="zoomLevel <= minZoom"
            type="button"
            @click="togglePanMode"
          >
            Pan
          </button>
          <button
            class="button button--ghost editor-stage__zoom-button"
            :disabled="zoomLevel <= minZoom"
            type="button"
            @click="zoomOut"
          >
            -
          </button>
          <button
            class="button button--ghost editor-stage__zoom-button"
            :disabled="zoomLevel >= maxZoom"
            type="button"
            @click="zoomIn"
          >
            +
          </button>
          <button
            class="button button--ghost editor-stage__zoom-fit"
            :disabled="zoomLevel === minZoom"
            type="button"
            @click="resetZoom"
          >
            Fit
          </button>
        </div>
        <p class="editor-stage__hover">{{ hoverLabel }}</p>
      </div>
    </header>

    <svg
      ref="svgRef"
      class="editor-canvas"
      :class="{
        'editor-canvas--pan': panMode,
        'editor-canvas--panning': dragState?.kind === 'pan',
      }"
      :viewBox="viewBox"
      @click="handleCanvasClick"
      @pointerdown.capture="beginPan"
      @pointermove="handlePointerMove"
      @pointerup="releaseDrag"
      @pointerleave="clearHover"
    >
      <defs v-if="grid">
        <pattern
          :id="gridPatternId"
          :x="gridPatternOrigin.x"
          :y="gridPatternOrigin.y"
          :width="gridSpacingInMeters(grid.spacing, grid.unit)"
          :height="gridSpacingInMeters(grid.spacing, grid.unit)"
          patternUnits="userSpaceOnUse"
        >
          <path
            :d="`M ${gridSpacingInMeters(grid.spacing, grid.unit)} 0 L 0 0 0 ${gridSpacingInMeters(grid.spacing, grid.unit)}`"
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
        fill="#f8f5ed"
      />

      <rect
        v-if="grid"
        :x="grid.rect.x"
        :y="grid.rect.y"
        :width="grid.rect.width"
        :height="grid.rect.height"
        :fill="`url(#${gridPatternId})`"
      />

      <slot name="underlay" />

      <g
        v-for="presentation in transformedEntities"
        :key="presentation.entity.id"
        class="entity-layer"
      >
        <path
          v-if="presentation.entity.geometryType === 'polygon'"
          :d="pointsToPath(presentation.svgVertices, true)"
          class="shape"
          :class="{ 'shape--selected': selectedEntityId === presentation.entity.id }"
          :style="{
            stroke: presentation.entity.style.stroke,
            fill: presentation.entity.style.fill,
            strokeWidth: presentation.entity.style.strokeWidth,
            opacity: presentation.opacity,
          }"
          @click="handleEntityClick($event, presentation.entity.id, presentation.selectionLayerType)"
          @pointerdown="beginEntityDrag($event, presentation.entity.id)"
        />
        <path
          v-else-if="presentation.entity.geometryType === 'polyline'"
          :d="pointsToPath(presentation.svgVertices)"
          class="shape shape--polyline"
          :class="{ 'shape--selected': selectedEntityId === presentation.entity.id }"
          :style="{
            stroke: presentation.entity.style.stroke,
            fill: 'none',
            strokeWidth: presentation.entity.style.strokeWidth,
            opacity: presentation.opacity,
            strokeDasharray: presentation.entity.style.dashed ? '2 1.4' : 'none',
          }"
          @click="handleEntityClick($event, presentation.entity.id, presentation.selectionLayerType)"
          @pointerdown="beginEntityDrag($event, presentation.entity.id)"
        />
        <g
          v-else
          class="point-symbol"
          @click="handleEntityClick($event, presentation.entity.id, presentation.selectionLayerType)"
        >
          <circle
            :cx="presentation.svgVertices[0].x"
            :cy="presentation.svgVertices[0].y"
            r="0.22"
            :class="{ 'shape--selected': selectedEntityId === presentation.entity.id }"
            :style="{ stroke: presentation.entity.style.stroke, fill: presentation.entity.style.fill }"
          />
          <path
            :d="`M ${presentation.svgVertices[0].x - 0.34} ${presentation.svgVertices[0].y} L ${presentation.svgVertices[0].x + 0.34} ${presentation.svgVertices[0].y} M ${presentation.svgVertices[0].x} ${presentation.svgVertices[0].y - 0.34} L ${presentation.svgVertices[0].x} ${presentation.svgVertices[0].y + 0.34}`"
            class="point-cross"
            :style="{ stroke: presentation.entity.style.stroke }"
          />
        </g>

        <text
          v-if="presentation.showLabel"
          class="entity-label"
          :class="presentation.labelClass"
          :x="presentation.labelPosition.x"
          :y="presentation.labelPosition.y"
        >
          {{ presentation.entity.label }}
        </text>

        <g v-if="selectedEntityId === presentation.entity.id">
          <circle
            v-for="(vertex, vertexIndex) in presentation.svgVertices"
            :key="`${presentation.entity.id}-${vertexIndex}`"
            class="vertex-handle"
            :cx="vertex.x"
            :cy="vertex.y"
            r="0.38"
            @pointerdown="beginVertexDrag($event, presentation.entity.id, vertexIndex)"
          />
        </g>
      </g>

      <g v-if="draftSvgVertices.length" class="draft-layer">
        <path
          :d="pointsToPath(draftSvgVertices, toolMode === 'polygon' && draftSvgVertices.length > 2)"
          class="draft-shape"
          :style="{
            stroke: draftStyle.stroke,
            fill: toolMode === 'polygon' ? draftStyle.fill : 'none',
            strokeWidth: draftStyle.strokeWidth,
            opacity: draftStyle.opacity,
          }"
        />
        <circle
          v-for="(vertex, index) in draftSvgVertices"
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
