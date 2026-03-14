<script setup lang="ts">
import { computed } from 'vue'
import { toDisplayValue } from '../../lib/geometry'
import type { GridPoint, MeasurementUnit, PlanEntity, SyncState, Template, ToolMode } from '../../types/planner'

const props = defineProps<{
  currentTemplate: Template | null
  draftVertices: GridPoint[]
  editable: boolean
  firebaseEnabled: boolean
  gridUnit: MeasurementUnit
  selectedEntity: PlanEntity | null
  statusMessage: string
  syncState: SyncState
  toolMode: ToolMode
}>()

const emit = defineEmits<{
  cancelDraft: []
  commitDraft: []
  deleteSelectedEntity: []
  updateSelectedEntity: [patch: Partial<PlanEntity>]
  updateSelectedEntityVertex: [vertexIndex: number, axis: 'x' | 'y', rawValue: number]
}>()

const canCommitDraft = computed(() => {
  if (props.toolMode === 'polyline') {
    return props.draftVertices.length >= 2
  }

  if (props.toolMode === 'polygon') {
    return props.draftVertices.length >= 3
  }

  return false
})

function displayVertexValue(vertex: GridPoint, axis: 'x' | 'y') {
  return toDisplayValue(vertex[axis], props.gridUnit)
}
</script>

<template>
  <aside class="inspector">
    <section class="inspector-card">
      <p class="eyebrow">Persistence</p>
      <h3>{{ firebaseEnabled ? 'Firebase ready' : 'Local-only mode' }}</h3>
      <p class="muted">{{ statusMessage }}</p>
      <span class="status-pill" :class="`status-pill--${syncState}`">{{ syncState }}</span>
    </section>

    <section class="inspector-card">
      <p class="eyebrow">Active template</p>
      <h3>{{ currentTemplate?.name ?? 'No template assigned' }}</h3>
      <p class="muted">
        {{ currentTemplate?.entities.length ?? 0 }} plotted entities
      </p>
    </section>

    <section v-if="toolMode === 'polyline' || toolMode === 'polygon'" class="inspector-card">
      <p class="eyebrow">Draft shape</p>
      <h3>{{ toolMode === 'polygon' ? 'Polygon draft' : 'Path draft' }}</h3>
      <p class="muted">{{ draftVertices.length }} snapped vertices</p>
      <div class="button-row">
        <button class="button button--primary" :disabled="!props.editable || !canCommitDraft" @click="emit('commitDraft')">
          Commit
        </button>
        <button class="button button--ghost" @click="emit('cancelDraft')">
          Cancel
        </button>
      </div>
    </section>

    <section v-if="selectedEntity" class="inspector-card inspector-card--grow">
      <p class="eyebrow">Selected entity</p>
      <h3>{{ selectedEntity.label || 'Untitled entity' }}</h3>

      <label class="field">
        <span>Label</span>
        <input
          name="entity-label"
          :value="selectedEntity.label"
          type="text"
          :disabled="!editable"
          @input="emit('updateSelectedEntity', { label: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <label class="field">
        <span>Description</span>
        <textarea
          name="entity-description"
          rows="4"
          :value="selectedEntity.description"
          :disabled="!editable"
          @input="emit('updateSelectedEntity', { description: ($event.target as HTMLTextAreaElement).value })"
        />
      </label>

      <label class="field">
        <span>Symbol key</span>
        <input
          name="entity-symbol"
          :value="selectedEntity.symbolKey ?? ''"
          type="text"
          placeholder="column, panel, tank"
          :disabled="!editable"
          @input="emit('updateSelectedEntity', { symbolKey: ($event.target as HTMLInputElement).value || undefined })"
        />
      </label>

      <label class="field">
        <span>Stroke</span>
        <input
          name="entity-stroke"
          :value="selectedEntity.style.stroke"
          type="color"
          :disabled="!editable"
          @input="emit('updateSelectedEntity', { style: { ...selectedEntity.style, stroke: ($event.target as HTMLInputElement).value } })"
        />
      </label>

      <div class="vertex-editor">
        <p class="eyebrow">Vertices</p>
        <div
          v-for="(vertex, index) in selectedEntity.vertices"
          :key="`${selectedEntity.id}-${index}`"
          class="vertex-row"
        >
          <span class="vertex-row__label">V{{ index + 1 }}</span>
          <div class="field-grid">
            <label class="field field--compact">
              <span>X</span>
              <input
                :name="`vertex-${index + 1}-x`"
                type="number"
                step="0.01"
                :value="displayVertexValue(vertex, 'x')"
                :disabled="!editable"
                @change="emit('updateSelectedEntityVertex', index, 'x', Number(($event.target as HTMLInputElement).value))"
              />
            </label>
            <label class="field field--compact">
              <span>Y</span>
              <input
                :name="`vertex-${index + 1}-y`"
                type="number"
                step="0.01"
                :value="displayVertexValue(vertex, 'y')"
                :disabled="!editable"
                @change="emit('updateSelectedEntityVertex', index, 'y', Number(($event.target as HTMLInputElement).value))"
              />
            </label>
          </div>
        </div>
      </div>

      <button class="button button--danger" :disabled="!editable" @click="emit('deleteSelectedEntity')">
        Delete entity
      </button>
    </section>

    <section v-else class="inspector-card">
      <p class="eyebrow">Inspector</p>
      <h3>Nothing selected</h3>
      <p class="muted">Select an entity to rename it, restyle it, or inspect its vertices.</p>
    </section>
  </aside>
</template>
