<script setup lang="ts">
import { computed } from 'vue'
import { entityCenter, pointsToPath } from '../../lib/geometry'
import type { FacadeGuide, FacadeProjection } from '../../lib/exterior'
import type { ExteriorTemplate, Floor, GridPoint, PlanEntity } from '../../types/planner'

type BuildingDensityMode = 'clean' | 'balanced' | 'full'

interface ReviewFloor {
  floor: Floor
  bottomOffset: number
  projection: FacadeProjection
  template: ExteriorTemplate | null
  isAssigned: boolean
  entityCount: number
  guideCount: number
}

const props = defineProps<{
  buildingHeight: number
  floors: ReviewFloor[]
  selectedFloorId: string | null
  hoveredFloorId: string | null
  densityMode: BuildingDensityMode
  showGeometry: boolean
  showGuides: boolean
  showLabels: boolean
}>()

const emit = defineEmits<{
  selectFloor: [floorId: string]
  hoverFloor: [floorId: string | null]
}>()

const pixelsPerMeter = 44
const minCanvasHeight = 1200
const gutterWidth = 8.75
const canvasPadding = {
  horizontal: 1.25,
  top: 1.2,
  bottom: 0.85,
}
const pointRadius = 0.16
const pointCrossRadius = 0.24
const labelOffset = {
  x: 0.34,
  y: -0.24,
}

const maxFacadeWidth = computed(() =>
  Math.max(
    10,
    ...props.floors.map((item) => item.projection.width),
  ),
)

const viewBoxGeometry = computed(() => ({
  minX: -(gutterWidth + canvasPadding.horizontal),
  minY: -canvasPadding.top,
  width: gutterWidth + maxFacadeWidth.value + canvasPadding.horizontal * 2,
  height: Math.max(props.buildingHeight, 3) + canvasPadding.top + canvasPadding.bottom,
}))

const viewBox = computed(
  () =>
    `${viewBoxGeometry.value.minX} ${viewBoxGeometry.value.minY} ${viewBoxGeometry.value.width} ${viewBoxGeometry.value.height}`,
)

const canvasWidthPx = computed(() => Math.round(viewBoxGeometry.value.width * pixelsPerMeter))
const canvasHeightPx = computed(() =>
  Math.max(minCanvasHeight, Math.round(viewBoxGeometry.value.height * pixelsPerMeter)),
)

const detailFloorId = computed(() => props.selectedFloorId ?? props.hoveredFloorId)

function floorTopY(bottomOffset: number, floorHeight: number) {
  return props.buildingHeight - (bottomOffset + floorHeight)
}

function toStackedPoint(bottomOffset: number, point: GridPoint): GridPoint {
  return {
    x: point.x,
    y: props.buildingHeight - (bottomOffset + point.y),
  }
}

function entityPath(bottomOffset: number, entity: PlanEntity) {
  return pointsToPath(
    entity.vertices.map((vertex) => toStackedPoint(bottomOffset, vertex)),
    entity.geometryType === 'polygon',
  )
}

function entityLabelPosition(bottomOffset: number, entity: PlanEntity) {
  const anchor = toStackedPoint(bottomOffset, entityCenter(entity))
  return {
    x: anchor.x + labelOffset.x,
    y: anchor.y + labelOffset.y,
  }
}

function guideLabelAnchorX(horizontalStart: number, horizontalEnd: number) {
  if (horizontalStart === horizontalEnd) {
    return horizontalStart + 0.22
  }

  return (horizontalStart + horizontalEnd) / 2 + 0.14
}

function guideLabelAnchorY(topY: number, index: number) {
  return topY - 0.16 - (index % 3) * 0.2
}

function guideLabelTransform(guide: FacadeGuide, topY: number, index: number) {
  const x = guideLabelAnchorX(guide.horizontalStart, guide.horizontalEnd)
  const y = guideLabelAnchorY(topY, index)
  return `rotate(-42 ${x} ${y})`
}

function isDetailedFloor(floorId: string) {
  return detailFloorId.value === floorId
}

function isHighlightedFloor(floorId: string) {
  return props.selectedFloorId === floorId || (!props.selectedFloorId && props.hoveredFloorId === floorId)
}

function floorBandFill(item: ReviewFloor) {
  if (isHighlightedFloor(item.floor.id)) {
    return item.isAssigned ? 'rgba(29, 78, 216, 0.11)' : 'rgba(22, 33, 43, 0.07)'
  }

  return item.isAssigned ? 'rgba(29, 78, 216, 0.04)' : 'rgba(107, 114, 128, 0.04)'
}

function floorBandStroke(item: ReviewFloor) {
  return isHighlightedFloor(item.floor.id) ? 'rgba(22, 33, 43, 0.42)' : 'rgba(22, 33, 43, 0.16)'
}

function shouldShowGuideLabel(item: ReviewFloor, guideIndex: number) {
  if (!props.showGuides || !props.showLabels) {
    return false
  }

  if (props.densityMode === 'full' || isDetailedFloor(item.floor.id)) {
    return true
  }

  if (props.densityMode === 'balanced') {
    return guideIndex === 0 || guideIndex === item.projection.guides.length - 1
  }

  return false
}

function shouldShowEntityLabel(floorId: string) {
  if (!props.showGeometry || !props.showLabels) {
    return false
  }

  if (props.densityMode === 'full') {
    return true
  }

  return isDetailedFloor(floorId)
}

function guideOpacity(floorId: string) {
  if (isDetailedFloor(floorId)) {
    return 1
  }

  if (props.densityMode === 'full') {
    return 0.72
  }

  if (props.densityMode === 'balanced') {
    return 0.46
  }

  return 0.24
}

function geometryOpacity(floorId: string) {
  if (isDetailedFloor(floorId)) {
    return 1
  }

  return props.densityMode === 'full' ? 0.9 : 0.72
}
</script>

<template>
  <div class="editor-stage">
    <header class="editor-stage__header">
      <div>
        <p class="eyebrow">Whole building view</p>
        <h2>Stacked elevation preview</h2>
      </div>
      <div class="editor-stage__meta">
        <p class="editor-stage__hint">
          Scroll the review surface to inspect the full facade stack. Select a floor to reveal detailed labels, then open it in the side editor.
        </p>
        <div class="whole-building__legend">
          <span class="whole-building__legend-item">
            <span class="whole-building__legend-swatch whole-building__legend-swatch--geometry" />
            Assigned geometry
          </span>
          <span class="whole-building__legend-item">
            <span class="whole-building__legend-swatch whole-building__legend-swatch--guide" />
            Guide lines
          </span>
          <span class="whole-building__legend-item">
            <span class="whole-building__legend-badge">Unassigned</span>
            Floor badge
          </span>
        </div>
      </div>
    </header>

    <div class="whole-building">
      <div class="whole-building__viewport">
        <svg
          class="whole-building__canvas"
          :viewBox="viewBox"
          preserveAspectRatio="xMinYMin meet"
          :style="{ width: `${canvasWidthPx}px`, height: `${canvasHeightPx}px` }"
        >
          <rect
            :x="viewBoxGeometry.minX"
            :y="viewBoxGeometry.minY"
            :width="viewBoxGeometry.width"
            :height="viewBoxGeometry.height"
            fill="#f8f5ed"
          />

          <g v-for="item in floors" :key="item.floor.id">
            <rect
              :x="-gutterWidth"
              :y="floorTopY(item.bottomOffset, item.floor.heightMeters)"
              :width="gutterWidth + maxFacadeWidth"
              :height="item.floor.heightMeters"
              class="whole-building__band"
              :fill="floorBandFill(item)"
              :stroke="floorBandStroke(item)"
              stroke-width="0.06"
            />

            <text
              class="whole-building__floor-name"
              :x="-gutterWidth + 0.45"
              :y="floorTopY(item.bottomOffset, item.floor.heightMeters) + 0.68"
            >
              {{ item.floor.name }}
            </text>
            <text
              class="whole-building__floor-meta"
              :x="-gutterWidth + 0.45"
              :y="floorTopY(item.bottomOffset, item.floor.heightMeters) + 1.08"
            >
              {{ item.floor.heightMeters.toFixed(2) }} m
            </text>

            <g class="whole-building__badge">
              <rect
                :x="-gutterWidth + 0.45"
                :y="floorTopY(item.bottomOffset, item.floor.heightMeters) + 1.36"
                :width="item.isAssigned ? 2.55 : 3.15"
                height="0.42"
                rx="0.21"
                :fill="item.isAssigned ? 'rgba(15, 118, 110, 0.13)' : 'rgba(107, 114, 128, 0.12)'"
              />
              <text
                class="whole-building__badge-text"
                :x="-gutterWidth + 0.66"
                :y="floorTopY(item.bottomOffset, item.floor.heightMeters) + 1.65"
              >
                {{ item.isAssigned ? 'Assigned' : 'Unassigned' }}
              </text>
            </g>

            <g v-if="showGuides">
              <g
                v-for="(guide, guideIndex) in item.projection.guides"
                :key="guide.id"
                :style="{ opacity: guideOpacity(item.floor.id) }"
              >
                <template v-if="guide.kind === 'column' || guide.horizontalStart === guide.horizontalEnd">
                  <line
                    :x1="guide.horizontalStart"
                    :y1="floorTopY(item.bottomOffset, item.floor.heightMeters)"
                    :x2="guide.horizontalStart"
                    :y2="floorTopY(item.bottomOffset, item.floor.heightMeters) + item.floor.heightMeters"
                    class="facade-guide-line facade-guide-line--column whole-building__guide-line"
                  />
                  <circle
                    :cx="guide.horizontalStart"
                    :cy="floorTopY(item.bottomOffset, item.floor.heightMeters)"
                    r="0.09"
                    class="facade-guide-marker"
                  />
                </template>
                <template v-else>
                  <line
                    :x1="guide.horizontalStart"
                    :y1="floorTopY(item.bottomOffset, item.floor.heightMeters) + 0.14"
                    :x2="guide.horizontalEnd"
                    :y2="floorTopY(item.bottomOffset, item.floor.heightMeters) + 0.14"
                    class="facade-guide-line facade-guide-line--span whole-building__guide-line"
                  />
                  <line
                    :x1="guide.horizontalStart"
                    :y1="floorTopY(item.bottomOffset, item.floor.heightMeters)"
                    :x2="guide.horizontalStart"
                    :y2="floorTopY(item.bottomOffset, item.floor.heightMeters) + item.floor.heightMeters"
                    class="facade-guide-line facade-guide-line--feature whole-building__guide-line"
                  />
                  <line
                    :x1="guide.horizontalEnd"
                    :y1="floorTopY(item.bottomOffset, item.floor.heightMeters)"
                    :x2="guide.horizontalEnd"
                    :y2="floorTopY(item.bottomOffset, item.floor.heightMeters) + item.floor.heightMeters"
                    class="facade-guide-line facade-guide-line--feature whole-building__guide-line"
                  />
                </template>
                <text
                  v-if="shouldShowGuideLabel(item, guideIndex)"
                  class="whole-building__guide-label"
                  :class="
                    guide.kind === 'column' || guide.horizontalStart === guide.horizontalEnd
                      ? 'facade-guide-label--column'
                      : 'facade-guide-label--feature'
                  "
                  :x="guideLabelAnchorX(guide.horizontalStart, guide.horizontalEnd)"
                  :y="guideLabelAnchorY(floorTopY(item.bottomOffset, item.floor.heightMeters), guideIndex)"
                  :transform="guideLabelTransform(guide, floorTopY(item.bottomOffset, item.floor.heightMeters), guideIndex)"
                >
                  {{ guide.label }}
                </text>
              </g>
            </g>

            <g v-if="showGeometry && item.template">
              <g
                v-for="entity in item.template.entities"
                :key="entity.id"
                class="entity-layer whole-building__entity-layer"
                :style="{ opacity: geometryOpacity(item.floor.id) }"
              >
                <path
                  v-if="entity.geometryType === 'polygon'"
                  :d="entityPath(item.bottomOffset, entity)"
                  class="shape whole-building__shape"
                  :style="{
                    stroke: entity.style.stroke,
                    fill: entity.style.fill,
                    strokeWidth: entity.style.strokeWidth,
                  }"
                />
                <path
                  v-else-if="entity.geometryType === 'polyline'"
                  :d="entityPath(item.bottomOffset, entity)"
                  class="shape shape--polyline whole-building__shape"
                  :style="{
                    stroke: entity.style.stroke,
                    fill: 'none',
                    strokeWidth: entity.style.strokeWidth,
                    strokeDasharray: entity.style.dashed ? '2 1.4' : 'none',
                  }"
                />
                <g v-else class="point-symbol">
                  <circle
                    class="whole-building__point"
                    :cx="toStackedPoint(item.bottomOffset, entity.vertices[0]).x"
                    :cy="toStackedPoint(item.bottomOffset, entity.vertices[0]).y"
                    :r="pointRadius"
                    :style="{ stroke: entity.style.stroke, fill: entity.style.fill }"
                  />
                  <path
                    :d="`M ${toStackedPoint(item.bottomOffset, entity.vertices[0]).x - pointCrossRadius} ${toStackedPoint(item.bottomOffset, entity.vertices[0]).y} L ${toStackedPoint(item.bottomOffset, entity.vertices[0]).x + pointCrossRadius} ${toStackedPoint(item.bottomOffset, entity.vertices[0]).y} M ${toStackedPoint(item.bottomOffset, entity.vertices[0]).x} ${toStackedPoint(item.bottomOffset, entity.vertices[0]).y - pointCrossRadius} L ${toStackedPoint(item.bottomOffset, entity.vertices[0]).x} ${toStackedPoint(item.bottomOffset, entity.vertices[0]).y + pointCrossRadius}`"
                    class="point-cross whole-building__point-cross"
                    :style="{ stroke: entity.style.stroke }"
                  />
                </g>

                <text
                  v-if="shouldShowEntityLabel(item.floor.id)"
                  class="whole-building__entity-label"
                  :x="entityLabelPosition(item.bottomOffset, entity).x"
                  :y="entityLabelPosition(item.bottomOffset, entity).y"
                >
                  {{ entity.label }}
                </text>
              </g>
            </g>

            <rect
              :x="-gutterWidth"
              :y="floorTopY(item.bottomOffset, item.floor.heightMeters)"
              :width="gutterWidth + maxFacadeWidth"
              :height="item.floor.heightMeters"
              class="whole-building__floor-hit"
              @click="emit('selectFloor', item.floor.id)"
              @pointerenter="emit('hoverFloor', item.floor.id)"
              @pointerleave="emit('hoverFloor', null)"
            />
          </g>
        </svg>
      </div>
    </div>
  </div>
</template>
