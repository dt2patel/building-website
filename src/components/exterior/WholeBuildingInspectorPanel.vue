<script setup lang="ts">
import type { ExteriorTemplate, Floor, SyncState } from '../../types/planner'

defineProps<{
  firebaseEnabled: boolean
  sideLabel: string
  statusMessage: string
  syncState: SyncState
  selectedFloor: {
    floor: Floor
    template: ExteriorTemplate | null
    isAssigned: boolean
    entityCount: number
    guideCount: number
  } | null
}>()

const emit = defineEmits<{
  openFloor: [floorId: string]
}>()
</script>

<template>
  <aside class="inspector">
    <section class="inspector-card">
      <p class="eyebrow">Persistence</p>
      <h3>{{ firebaseEnabled ? 'Firebase ready' : 'Local-only mode' }}</h3>
      <p class="muted">{{ statusMessage }}</p>
      <span class="status-pill" :class="`status-pill--${syncState}`">{{ syncState }}</span>
    </section>

    <section class="inspector-card inspector-card--grow">
      <p class="eyebrow">Building review</p>
      <template v-if="selectedFloor">
        <h3>{{ selectedFloor.floor.name }}</h3>
        <p class="muted">
          {{ sideLabel }} side
        </p>

        <div class="review-summary">
          <div class="review-summary__row">
            <span class="review-summary__label">Height</span>
            <strong>{{ selectedFloor.floor.heightMeters.toFixed(2) }} m</strong>
          </div>
          <div class="review-summary__row">
            <span class="review-summary__label">Assignment</span>
            <span
              class="status-pill"
              :class="selectedFloor.isAssigned ? 'status-pill--synced' : 'status-pill--ghost'"
            >
              {{ selectedFloor.isAssigned ? 'Assigned' : 'Unassigned' }}
            </span>
          </div>
          <div class="review-summary__row">
            <span class="review-summary__label">Template</span>
            <strong>{{ selectedFloor.template?.name ?? 'No exterior template' }}</strong>
          </div>
          <div class="review-summary__row">
            <span class="review-summary__label">Entities</span>
            <strong>{{ selectedFloor.entityCount }}</strong>
          </div>
          <div class="review-summary__row">
            <span class="review-summary__label">Guides</span>
            <strong>{{ selectedFloor.guideCount }}</strong>
          </div>
        </div>

        <button class="button button--primary review-summary__action" @click="emit('openFloor', selectedFloor.floor.id)">
          Open In Floor View
        </button>
      </template>

      <template v-else>
        <h3>No review target</h3>
        <p class="muted">No floors match the current building review filters.</p>
      </template>
    </section>
  </aside>
</template>
