import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createSeedProject } from '../config/seedProject'
import { exportFloorPdf } from '../lib/export'
import { cloneJson, fromDisplayValue } from '../lib/geometry'
import { isFirebaseConfigured } from '../services/firebase'
import {
  loadProject,
  saveProject,
  subscribeToProject,
  uploadExport,
} from '../services/plannerRepository'
import {
  layerColors,
  layerOrder,
  type GridPoint,
  type LayerType,
  type MeasurementUnit,
  type PlanEntity,
  type Project,
  type SyncState,
  type Template,
  type ToolMode,
} from '../types/planner'

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function timestamp() {
  return new Date().toISOString()
}

function entityLabel(layerType: LayerType, geometryType: PlanEntity['geometryType'], count: number) {
  return `${layerType} ${geometryType} ${count}`
}

export const usePlannerStore = defineStore('planner', () => {
  const firebaseEnabled = isFirebaseConfigured()
  const project = ref<Project>(createSeedProject())
  const selectedFloorId = ref(project.value.floors[0]?.id ?? '')
  const activeLayerType = ref<LayerType>('perimeter')
  const selectedEntityId = ref<string | null>(null)
  const toolMode = ref<ToolMode>('select')
  const draftVertices = ref<GridPoint[]>([])
  const syncState = ref<SyncState>('local')
  const statusMessage = ref('Connect to a live Firestore session to edit')
  const initialized = ref(false)
  const layerVisibility = ref<Record<LayerType, boolean>>({
    perimeter: true,
    structural: true,
    plumbing: true,
    fireSafety: true,
    electrical: true,
    custom: true,
  })

  let saveTimer: number | undefined
  let stopProjectSubscription: (() => void) | undefined
  const liveConnectionVerified = ref(false)
  const hasPendingWrites = ref(false)

  const selectedFloor = computed(
    () => project.value.floors.find((floor) => floor.id === selectedFloorId.value) ?? project.value.floors[0],
  )

  const currentTemplateId = computed(
    () => selectedFloor.value?.templateAssignments[activeLayerType.value] ?? null,
  )

  const currentTemplate = computed(
    () =>
      project.value.templates.find((template) => template.id === currentTemplateId.value) ?? null,
  )

  const selectedEntity = computed(
    () => currentTemplate.value?.entities.find((entity) => entity.id === selectedEntityId.value) ?? null,
  )

  const templatesByLayer = computed(() =>
    layerOrder.reduce(
      (accumulator, layerType) => {
        accumulator[layerType] = project.value.templates.filter((template) => template.layerType === layerType)
        return accumulator
      },
      {} as Record<LayerType, Template[]>,
    ),
  )

  const visibleTemplates = computed(() => {
    const floor = selectedFloor.value
    if (!floor) {
      return []
    }

    return layerOrder
      .filter((layerType) => layerVisibility.value[layerType])
      .map((layerType) => floor.templateAssignments[layerType])
      .filter((templateId): templateId is string => Boolean(templateId))
      .map((templateId) => project.value.templates.find((template) => template.id === templateId))
      .filter((template): template is Template => Boolean(template))
  })

  const canEdit = computed(() => firebaseEnabled && liveConnectionVerified.value)

  function lockEditingStatus(message: string) {
    liveConnectionVerified.value = false
    hasPendingWrites.value = false
    syncState.value = firebaseEnabled ? 'error' : 'local'
    statusMessage.value = message
    draftVertices.value = []
    toolMode.value = 'select'
  }

  function applyProjectSnapshot(nextProject: Project) {
    const nextSelectedFloorId = nextProject.floors.some((floor) => floor.id === selectedFloorId.value)
      ? selectedFloorId.value
      : nextProject.floors[0]?.id ?? ''

    const entityStillExists = nextProject.templates.some((template) =>
      template.entities.some((entity) => entity.id === selectedEntityId.value),
    )

    project.value = nextProject
    selectedFloorId.value = nextSelectedFloorId

    if (!entityStillExists) {
      selectedEntityId.value = null
    }
  }

  function updateRealtimeState(state: { exists: boolean; hasPendingWrites: boolean; live: boolean }) {
    hasPendingWrites.value = state.hasPendingWrites
    liveConnectionVerified.value = state.live

    if (!firebaseEnabled) {
      syncState.value = 'local'
      statusMessage.value = 'Connect to a live Firestore session to edit'
      return
    }

    if (!state.live) {
      lockEditingStatus('Read-only until a live Firestore connection is restored')
      return
    }

    syncState.value = state.hasPendingWrites ? 'syncing' : 'synced'
    statusMessage.value = state.hasPendingWrites
      ? 'Syncing live changes to Firebase...'
      : state.exists
        ? 'Live Firestore session connected'
        : 'Live Firestore session connected. First edit will create the shared project.'
  }

  function startRealtimeSync() {
    stopProjectSubscription?.()

    if (!firebaseEnabled) {
      lockEditingStatus('Firebase config missing. Editing is locked.')
      return
    }

    syncState.value = 'syncing'
    statusMessage.value = 'Connecting to live Firestore session...'

    stopProjectSubscription = subscribeToProject(project.value.id, {
      onProject: (nextProject) => {
        applyProjectSnapshot(nextProject)
      },
      onStateChange: (state) => {
        updateRealtimeState(state)
      },
      onError: (error) => {
        lockEditingStatus(error.message || 'Live Firestore listener failed')
      },
    })
  }

  function ensureEditableSession() {
    if (!canEdit.value) {
      statusMessage.value = firebaseEnabled
        ? 'Read-only until a live Firestore connection is restored'
        : 'Firebase config missing. Editing is locked.'
      return false
    }

    return true
  }

  async function initialize() {
    if (initialized.value) {
      return
    }

    project.value = await loadProject()
    selectedFloorId.value = project.value.floors[0]?.id ?? ''
    initialized.value = true
    if (!firebaseEnabled) {
      syncState.value = 'local'
      statusMessage.value = 'Firebase config missing. Editing is locked.'
      return
    }

    startRealtimeSync()
  }

  function touchProject() {
    project.value.updatedAt = timestamp()
  }

  function queueSave() {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      void persist()
    }, 500)
  }

  async function persist() {
    if (!firebaseEnabled) {
      lockEditingStatus('Firebase config missing. Editing is locked.')
      return
    }

    syncState.value = 'syncing'
    statusMessage.value = 'Syncing live changes to Firebase...'

    try {
      await saveProject(project.value)
      syncState.value = hasPendingWrites.value ? 'syncing' : 'synced'
      statusMessage.value = hasPendingWrites.value
        ? 'Syncing live changes to Firebase...'
        : 'Synced to Firebase'
    } catch (error) {
      lockEditingStatus(error instanceof Error ? error.message : 'Unable to persist planner state')
    }
  }

  function selectFloor(floorId: string) {
    selectedFloorId.value = floorId
    selectedEntityId.value = null
    draftVertices.value = []
    toolMode.value = 'select'
  }

  function setActiveLayer(layerType: LayerType) {
    activeLayerType.value = layerType
    selectedEntityId.value = null
    draftVertices.value = []
    toolMode.value = 'select'
  }

  function setToolMode(mode: ToolMode) {
    if (mode !== 'select' && !ensureEditableSession()) {
      return
    }

    toolMode.value = mode
    selectedEntityId.value = null
    if (mode === 'select') {
      draftVertices.value = []
    }
  }

  function selectEntity(selection: { entityId: string | null; layerType?: LayerType } | null) {
    if (selection?.layerType && selection.layerType !== activeLayerType.value) {
      activeLayerType.value = selection.layerType
      draftVertices.value = []
    }

    selectedEntityId.value = selection?.entityId ?? null
    toolMode.value = 'select'
  }

  function toggleLayerVisibility(layerType: LayerType) {
    layerVisibility.value[layerType] = !layerVisibility.value[layerType]
  }

  function assignTemplate(layerType: LayerType, templateId: string | null) {
    if (!ensureEditableSession()) {
      return
    }

    const floor = selectedFloor.value
    if (!floor) {
      return
    }

    floor.templateAssignments[layerType] = templateId
    touchProject()
    queueSave()

    if (layerType === activeLayerType.value) {
      selectedEntityId.value = null
      draftVertices.value = []
      toolMode.value = 'select'
    }
  }

  function updateGridSettings(unit: MeasurementUnit, spacing: number) {
    if (!ensureEditableSession()) {
      return
    }

    project.value.gridUnit = unit
    project.value.gridSpacing = spacing
    touchProject()
    queueSave()
  }

  function updatePlotVertex(
    vertexIndex: number,
    axis: 'x' | 'y',
    rawValue: number,
    unit: MeasurementUnit,
  ) {
    if (!ensureEditableSession()) {
      return
    }

    const vertex = project.value.plotBoundary[vertexIndex]
    if (!vertex || Number.isNaN(rawValue)) {
      return
    }

    vertex[axis] = fromDisplayValue(rawValue, unit)
    touchProject()
    queueSave()
  }

  function createTemplate() {
    if (!ensureEditableSession()) {
      return
    }

    const layerType = activeLayerType.value
    const nextNumber = templatesByLayer.value[layerType].length + 1
    const name = `${layerType} concept ${nextNumber}`
    const template: Template = {
      id: `${slugify(name)}-${Date.now()}`,
      name,
      layerType,
      version: 1,
      status: 'draft',
      updatedAt: timestamp(),
      entities: [],
    }

    project.value.templates.push(template)
    assignTemplate(layerType, template.id)

    touchProject()
    queueSave()
  }

  function cloneCurrentTemplate() {
    if (!ensureEditableSession()) {
      return
    }

    if (!currentTemplate.value) {
      return
    }

    const source = cloneJson(currentTemplate.value)
    const clonedName = `${source.name} copy`
    const template: Template = {
      ...source,
      id: `${slugify(clonedName)}-${Date.now()}`,
      name: clonedName,
      version: source.version + 1,
      status: 'draft',
      updatedAt: timestamp(),
      entities: source.entities.map((entity, index) => ({
        ...entity,
        id: `${entity.id}-copy-${index + 1}-${Date.now()}`,
      })),
    }

    project.value.templates.push(template)
    assignTemplate(template.layerType, template.id)
    touchProject()
    queueSave()
  }

  function ensureEditableTemplate() {
    if (!ensureEditableSession()) {
      return null
    }

    if (currentTemplate.value) {
      return currentTemplate.value
    }

    const template: Template = {
      id: `${activeLayerType.value}-blank-${Date.now()}`,
      name: `${activeLayerType.value} working`,
      layerType: activeLayerType.value,
      version: 1,
      status: 'draft',
      updatedAt: timestamp(),
      entities: [],
    }

    project.value.templates.push(template)
    assignTemplate(activeLayerType.value, template.id)
    return template
  }

  function addVertexToDraft(point: GridPoint) {
    if (!ensureEditableSession()) {
      return
    }

    if (toolMode.value === 'point') {
      const template = ensureEditableTemplate()
      if (!template) {
        return
      }
      const entityCount = template.entities.length + 1
      const entity: PlanEntity = {
        id: `${activeLayerType.value}-point-${Date.now()}`,
        layerType: activeLayerType.value,
        geometryType: 'point',
        label: entityLabel(activeLayerType.value, 'point', entityCount),
        description: '',
        symbolKey: 'marker',
        vertices: [point],
        style: {
          stroke: layerColors[activeLayerType.value],
          fill: '#ffffff',
          strokeWidth: 0.6,
          opacity: 1,
        },
        metadata: {},
      }

      template.entities.push(entity)
      template.updatedAt = timestamp()
      selectedEntityId.value = entity.id
      toolMode.value = 'select'
      touchProject()
      queueSave()
      return
    }

    draftVertices.value = [...draftVertices.value, point]
  }

  function commitDraft() {
    const template = ensureEditableTemplate()
    if (!template) {
      return
    }
    const minimumVertices = toolMode.value === 'polygon' ? 3 : 2
    if (!['polyline', 'polygon'].includes(toolMode.value) || draftVertices.value.length < minimumVertices) {
      return
    }

    const geometryType = toolMode.value as PlanEntity['geometryType']
    const entityCount = template.entities.length + 1
    const entity: PlanEntity = {
      id: `${activeLayerType.value}-${geometryType}-${Date.now()}`,
      layerType: activeLayerType.value,
      geometryType,
      label: entityLabel(activeLayerType.value, geometryType, entityCount),
      description: '',
      vertices: cloneJson(draftVertices.value),
      style: {
        stroke: layerColors[activeLayerType.value],
        fill: geometryType === 'polygon' ? `${layerColors[activeLayerType.value]}33` : 'none',
        strokeWidth: 0.8,
        opacity: 0.95,
      },
      metadata: {},
    }

    template.entities.push(entity)
    template.updatedAt = timestamp()
    draftVertices.value = []
    selectedEntityId.value = entity.id
    toolMode.value = 'select'
    touchProject()
    queueSave()
  }

  function cancelDraft() {
    draftVertices.value = []
  }

  function updateSelectedEntity(patch: Partial<PlanEntity>) {
    if (!ensureEditableSession()) {
      return
    }

    if (!selectedEntity.value || !currentTemplate.value) {
      return
    }

    Object.assign(selectedEntity.value, patch)
    currentTemplate.value.updatedAt = timestamp()
    touchProject()
    queueSave()
  }

  function updateSelectedEntityMetadata(key: string, value: string) {
    if (!ensureEditableSession()) {
      return
    }

    if (!selectedEntity.value || !currentTemplate.value) {
      return
    }

    selectedEntity.value.metadata[key] = value
    currentTemplate.value.updatedAt = timestamp()
    touchProject()
    queueSave()
  }

  function updateVertex(entityId: string, vertexIndex: number, point: GridPoint) {
    if (!ensureEditableSession()) {
      return
    }

    const template = visibleTemplates.value.find((item) => item.entities.some((entity) => entity.id === entityId))
    const entity = template?.entities.find((item) => item.id === entityId)
    if (!template || !entity || !entity.vertices[vertexIndex]) {
      return
    }

    entity.vertices[vertexIndex] = point
    template.updatedAt = timestamp()
    touchProject()
    queueSave()
  }

  function updateSelectedEntityVertex(
    vertexIndex: number,
    axis: 'x' | 'y',
    rawValue: number,
    unit: MeasurementUnit,
  ) {
    if (!ensureEditableSession()) {
      return
    }

    if (!selectedEntity.value || Number.isNaN(rawValue)) {
      return
    }

    const point = cloneJson(selectedEntity.value.vertices[vertexIndex])
    if (!point) {
      return
    }

    point[axis] = fromDisplayValue(rawValue, unit)
    updateVertex(selectedEntity.value.id, vertexIndex, point)
  }

  function deleteSelectedEntity() {
    if (!ensureEditableSession()) {
      return
    }

    if (!selectedEntity.value || !currentTemplate.value) {
      return
    }

    currentTemplate.value.entities = currentTemplate.value.entities.filter(
      (entity) => entity.id !== selectedEntity.value?.id,
    )
    currentTemplate.value.updatedAt = timestamp()
    selectedEntityId.value = null
    touchProject()
    queueSave()
  }

  async function exportActiveFloor(svg: SVGSVGElement) {
    const floor = selectedFloor.value
    if (!floor) {
      return
    }

    const visibleLayers = layerOrder.filter((layerType) => layerVisibility.value[layerType])
    const blob = await exportFloorPdf({
      svg,
      project: project.value,
      floor,
      visibleLayers,
    })

    const downloadUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = downloadUrl
    anchor.download = `${project.value.id}-${floor.id}.pdf`
    anchor.click()
    URL.revokeObjectURL(downloadUrl)

    try {
      await uploadExport(project.value, floor.id, visibleLayers)
      statusMessage.value = 'Export downloaded locally and logged to Firestore'
    } catch (error) {
      statusMessage.value = error instanceof Error ? error.message : 'Export logging failed'
    }
  }

  return {
    activeLayerType,
    cancelDraft,
    canEdit,
    cloneCurrentTemplate,
    commitDraft,
    createTemplate,
    currentTemplate,
    currentTemplateId,
    deleteSelectedEntity,
    draftVertices,
    exportActiveFloor,
    initialize,
    initialized,
    layerVisibility,
    liveConnectionVerified,
    persist,
    project,
    selectedEntity,
    selectedEntityId,
    selectedFloor,
    selectedFloorId,
    selectEntity,
    selectFloor,
    setActiveLayer,
    setToolMode,
    statusMessage,
    syncState,
    templatesByLayer,
    toggleLayerVisibility,
    toolMode,
    updateSelectedEntity,
    updateSelectedEntityMetadata,
    updateSelectedEntityVertex,
    updateVertex,
    updateGridSettings,
    updatePlotVertex,
    visibleTemplates,
    addVertexToDraft,
    assignTemplate,
    cleanup() {
      stopProjectSubscription?.()
      stopProjectSubscription = undefined
    },
  }
})
