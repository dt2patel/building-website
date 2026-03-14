<script setup lang="ts">
import { computed } from 'vue'
import type { GridPoint, PlanEntity, SyncState, Template, ToolMode } from '../../types/planner'

const props = defineProps<{
  currentTemplate: Template | null
  draftVertices: GridPoint[]
  firebaseEnabled: boolean
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
        <button class="button button--primary" :disabled="!canCommitDraft" @click="emit('commitDraft')">
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
          @input="emit('updateSelectedEntity', { label: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <label class="field">
        <span>Description</span>
        <textarea
          name="entity-description"
          rows="4"
          :value="selectedEntity.description"
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
          @input="emit('updateSelectedEntity', { symbolKey: ($event.target as HTMLInputElement).value || undefined })"
        />
      </label>

      <label class="field">
        <span>Stroke</span>
        <input
          name="entity-stroke"
          :value="selectedEntity.style.stroke"
          type="color"
          @input="emit('updateSelectedEntity', { style: { ...selectedEntity.style, stroke: ($event.target as HTMLInputElement).value } })"
        />
      </label>

      <ul class="vertex-list">
        <li v-for="(vertex, index) in selectedEntity.vertices" :key="`${selectedEntity.id}-${index}`">
          V{{ index + 1 }} → {{ vertex.x }}, {{ vertex.y }}
        </li>
      </ul>

      <button class="button button--danger" @click="emit('deleteSelectedEntity')">
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
