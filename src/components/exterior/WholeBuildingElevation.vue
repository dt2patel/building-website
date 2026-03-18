<script setup lang="ts">
import type { ExteriorTemplate, Floor } from '../../types/planner'

defineProps<{
  buildingHeight: number
  floors: Array<{
    floor: Floor
    bottomOffset: number
    template: ExteriorTemplate | null
  }>
}>()

const emit = defineEmits<{
  openFloor: [floorId: string]
}>()

function scaleY(totalHeight: number, value: number) {
  if (totalHeight <= 0) {
    return 0
  }

  return 100 - (value / totalHeight) * 100
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
        <p class="editor-stage__hint">Click a floor band to jump back into the side editor for that floor.</p>
      </div>
    </header>

    <div class="whole-building">
      <svg class="whole-building__canvas" viewBox="0 0 100 100" preserveAspectRatio="none">
        <rect x="12" y="4" width="76" height="92" fill="#fffdf8" stroke="rgba(22, 33, 43, 0.16)" stroke-width="0.6" />

        <g v-for="item in floors" :key="item.floor.id">
          <rect
            x="12"
            :y="scaleY(buildingHeight, item.bottomOffset + item.floor.heightMeters)"
            width="76"
            :height="((item.floor.heightMeters / buildingHeight) * 92)"
            :fill="item.template ? 'rgba(29, 78, 216, 0.08)' : 'rgba(107, 114, 128, 0.06)'"
            stroke="rgba(22, 33, 43, 0.2)"
            stroke-width="0.4"
            @click="emit('openFloor', item.floor.id)"
          />
          <text x="16" :y="scaleY(buildingHeight, item.bottomOffset + item.floor.heightMeters / 2)" class="entity-label">
            {{ item.floor.name }} • {{ item.floor.heightMeters.toFixed(2) }}m
          </text>
        </g>
      </svg>
    </div>
  </div>
</template>
