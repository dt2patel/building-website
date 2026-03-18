import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  clearExteriorAssignments,
  createDefaultEntityStyle,
  entityLabel,
  normalizeHeightMeters,
  sideLabel,
  timestamp,
} from '../lib/plannerModel'
import { cloneJson, fromDisplayValue } from '../lib/geometry'
import {
  exteriorTemplateMatchesFloor,
  floorBottomOffset,
  getAssignedExteriorTemplate,
  projectFloorFacadeGuides,
  stackedElevationHeight,
} from '../lib/exterior'
import { useAuthStore } from './authStore'
import { isFirebaseConfigured } from '../services/firebase'
import {
  cacheProjectStateLocally,
  loadProjectMeta,
  loadSave,
  loadSaves,
  saveActiveProjectState,
  setLastOpenedSave,
} from '../services/plannerRepository'
import {
  getExteriorAssignment,
  setExteriorAssignment,
  type CardinalSide,
  type ExteriorTemplate,
  type GridPoint,
  type MeasurementUnit,
  type PlanEntity,
  type Project,
  type ProjectMeta,
  type ProjectSaveSummary,
  type SyncState,
  type ToolMode,
} from '../types/planner'

export const useExteriorPlannerStore = defineStore('exteriorPlanner', () => {
  const auth = useAuthStore()
  const firebaseEnabled = isFirebaseConfigured()
  const project = ref<Project | null>(null)
  const projectMeta = ref<ProjectMeta | null>(null)
  const activeSaveId = ref('')
  const availableSaves = ref<ProjectSaveSummary[]>([])
  const selectedFloorId = ref('')
  const selectedSide = ref<CardinalSide>('east')
  const selectedEntityId = ref<string | null>(null)
  const toolMode = ref<ToolMode>('select')
  const draftVertices = ref<GridPoint[]>([])
  const syncState = ref<SyncState>('local')
  const statusMessage = ref('Select a project save to start editing')
  const activeView = ref<'floor' | 'building'>('floor')
  const initialized = ref(false)
  const editableMembership = ref(false)

  let saveTimer: number | undefined
  const lastSyncedProject = ref<Project | null>(null)
  const currentProjectId = ref('')
  const currentContextKey = ref('')

  const selectedFloor = computed(
    () => project.value?.floors.find((floor) => floor.id === selectedFloorId.value) ?? project.value?.floors[0],
  )

  const filteredTemplates = computed(() => {
    if (!project.value || !selectedFloor.value) {
      return []
    }

    return project.value.exteriorTemplates.filter((template) =>
      exteriorTemplateMatchesFloor(template, selectedFloor.value!, selectedSide.value),
    )
  })

  const currentTemplateId = computed(() => {
    if (!selectedFloor.value) {
      return null
    }

    return getExteriorAssignment(selectedFloor.value.exterior, selectedSide.value)
  })

  const currentTemplate = computed(() =>
    project.value?.exteriorTemplates.find((template) => template.id === currentTemplateId.value) ?? null,
  )

  const selectedEntity = computed(
    () => currentTemplate.value?.entities.find((entity) => entity.id === selectedEntityId.value) ?? null,
  )

  const canEdit = computed(() => editableMembership.value && firebaseEnabled)

  const facadeProjection = computed(() => {
    if (!project.value || !selectedFloor.value) {
      return null
    }

    return projectFloorFacadeGuides(project.value, selectedFloor.value, selectedSide.value)
  })

  const stackedFloors = computed(() => {
    if (!project.value) {
      return []
    }

    return project.value.floors.map((floor) => ({
      floor,
      bottomOffset: floorBottomOffset(project.value!, floor.id),
      template: getAssignedExteriorTemplate(project.value!, floor, selectedSide.value),
    }))
  })

  const buildingHeight = computed(() => (project.value ? stackedElevationHeight(project.value) : 0))

  function hasUnsyncedChanges() {
    if (!project.value) {
      return false
    }

    if (!lastSyncedProject.value) {
      return true
    }

    return JSON.stringify(project.value) !== JSON.stringify(lastSyncedProject.value)
  }

  function clearEditorSelection() {
    selectedEntityId.value = null
    draftVertices.value = []
    toolMode.value = 'select'
  }

  function touchProject() {
    if (!project.value) {
      return
    }

    project.value.updatedAt = timestamp()
    cacheProjectStateLocally(project.value, {
      saveId: activeSaveId.value,
      userId: auth.currentUid ?? undefined,
    })
  }

  function queueSave() {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      void persist()
    }, 500)
  }

  function ensureEditableSession() {
    if (!editableMembership.value) {
      statusMessage.value = 'You only have view access for this project.'
      return false
    }

    if (!canEdit.value) {
      statusMessage.value = firebaseEnabled
        ? 'Editing is unavailable for this project.'
        : 'Firebase config missing. Editing is locked.'
      return false
    }

    return true
  }

  async function refreshSaveLists() {
    if (!currentProjectId.value) {
      availableSaves.value = []
      return
    }

    availableSaves.value = await loadSaves(currentProjectId.value, { archived: false })
    projectMeta.value = await loadProjectMeta(currentProjectId.value)
  }

  async function initialize(options: {
    projectId: string
    saveId: string
    canEdit: boolean
  }) {
    const contextKey = `${options.projectId}:${options.saveId}:${options.canEdit}`
    if (initialized.value && currentContextKey.value === contextKey) {
      return
    }

    window.clearTimeout(saveTimer)
    currentContextKey.value = contextKey
    currentProjectId.value = options.projectId
    activeSaveId.value = options.saveId
    editableMembership.value = options.canEdit
    clearEditorSelection()

    projectMeta.value = await loadProjectMeta(options.projectId)
    project.value = await loadSave(options.projectId, options.saveId, auth.currentUid ?? undefined)
    selectedFloorId.value = project.value.floors[0]?.id ?? ''
    lastSyncedProject.value = cloneJson(project.value)
    await refreshSaveLists()
    await setLastOpenedSave(options.projectId, options.saveId)
    initialized.value = true

    if (!firebaseEnabled) {
      syncState.value = 'local'
      statusMessage.value = 'Firebase configuration is missing.'
      return
    }

    syncState.value = 'synced'
    statusMessage.value = 'Loaded from Firebase'
  }

  async function persist() {
    if (!project.value) {
      return
    }

    if (!firebaseEnabled) {
      syncState.value = 'error'
      statusMessage.value = 'Firebase config missing. Editing is locked.'
      return
    }

    syncState.value = 'syncing'
    statusMessage.value = 'Syncing live changes to Firebase...'

    try {
      await saveActiveProjectState(lastSyncedProject.value, project.value, {
        projectId: currentProjectId.value,
        saveId: activeSaveId.value,
        userId: auth.currentUid ?? undefined,
      })
      lastSyncedProject.value = cloneJson(project.value)
      syncState.value = 'synced'
      statusMessage.value = 'Synced to Firebase'
      await refreshSaveLists()
    } catch (error) {
      syncState.value = 'error'
      statusMessage.value = error instanceof Error ? error.message : 'Unable to persist planner state'
      clearEditorSelection()
    }
  }

  function selectFloor(floorId: string) {
    selectedFloorId.value = floorId
    clearEditorSelection()
    activeView.value = 'floor'
  }

  function selectSide(side: CardinalSide) {
    selectedSide.value = side
    clearEditorSelection()
  }

  function setActiveView(view: 'floor' | 'building') {
    activeView.value = view
    clearEditorSelection()
  }

  function assignTemplate(templateId: string | null) {
    if (!ensureEditableSession()) {
      return
    }

    const floor = selectedFloor.value
    if (!floor) {
      return
    }

    if (templateId) {
      const template = project.value?.exteriorTemplates.find((item) => item.id === templateId) ?? null
      if (!template || !exteriorTemplateMatchesFloor(template, floor, selectedSide.value)) {
        statusMessage.value = 'Only templates for this side and floor height can be assigned.'
        return
      }
    }

    setExteriorAssignment(floor.exterior, selectedSide.value, templateId)
    touchProject()
    queueSave()
    clearEditorSelection()
  }

  function updateFloorHeight(rawValue: number, unit: MeasurementUnit) {
    if (!ensureEditableSession() || !selectedFloor.value || Number.isNaN(rawValue)) {
      return
    }

    const nextHeight = normalizeHeightMeters(fromDisplayValue(rawValue, unit))
    selectedFloor.value.heightMeters = nextHeight
    clearExteriorAssignments(selectedFloor.value)
    touchProject()
    queueSave()
    clearEditorSelection()
    statusMessage.value = 'Floor height changed. Exterior side assignments were cleared.'
  }

  function updateGridSettings(unit: MeasurementUnit, spacing: number) {
    if (!ensureEditableSession() || !project.value) {
      return
    }

    project.value.gridUnit = unit
    project.value.gridSpacing = spacing
    touchProject()
    queueSave()
  }

  function ensureEditableTemplate() {
    if (!ensureEditableSession() || !project.value || !selectedFloor.value) {
      return null
    }

    if (currentTemplate.value) {
      return currentTemplate.value
    }

    const template: ExteriorTemplate = {
      id: `ext-${selectedSide.value}-blank-${Date.now()}`,
      name: `${sideLabel(selectedSide.value)} ${selectedFloor.value.heightMeters.toFixed(2)}m working`,
      side: selectedSide.value,
      heightMeters: selectedFloor.value.heightMeters,
      version: 1,
      status: 'draft',
      updatedAt: timestamp(),
      entities: [],
    }

    project.value.exteriorTemplates.push(template)
    setExteriorAssignment(selectedFloor.value.exterior, selectedSide.value, template.id)
    return template
  }

  function createTemplate() {
    const template = ensureEditableTemplate()
    if (!template) {
      return
    }

    touchProject()
    queueSave()
  }

  function cloneCurrentTemplate() {
    if (!ensureEditableSession() || !project.value || !currentTemplate.value || !selectedFloor.value) {
      return
    }

    const source = cloneJson(currentTemplate.value)
    const template: ExteriorTemplate = {
      ...source,
      id: `${source.id}-copy-${Date.now()}`,
      name: `${source.name} copy`,
      version: source.version + 1,
      status: 'draft',
      updatedAt: timestamp(),
      entities: source.entities.map((entity, index) => ({
        ...entity,
        id: `${entity.id}-copy-${index + 1}-${Date.now()}`,
      })),
    }

    project.value.exteriorTemplates.push(template)
    setExteriorAssignment(selectedFloor.value.exterior, selectedSide.value, template.id)
    touchProject()
    queueSave()
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

  function selectEntity(entityId: string | null) {
    selectedEntityId.value = entityId
    toolMode.value = 'select'
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
      const entity: PlanEntity = {
        id: `${selectedSide.value}-point-${Date.now()}`,
        layerType: 'custom',
        geometryType: 'point',
        label: entityLabel('custom', 'point', template.entities.length + 1),
        description: '',
        symbolKey: 'marker',
        vertices: [point],
        style: createDefaultEntityStyle('custom', 'point'),
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
    const entity: PlanEntity = {
      id: `${selectedSide.value}-${geometryType}-${Date.now()}`,
      layerType: 'custom',
      geometryType,
      label: entityLabel('custom', geometryType, template.entities.length + 1),
      description: '',
      vertices: cloneJson(draftVertices.value),
      style: createDefaultEntityStyle('custom', geometryType),
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
    if (!ensureEditableSession() || !selectedEntity.value || !currentTemplate.value) {
      return
    }

    Object.assign(selectedEntity.value, patch)
    currentTemplate.value.updatedAt = timestamp()
    touchProject()
    queueSave()
  }

  function updateVertex(entityId: string, vertexIndex: number, point: GridPoint) {
    if (!ensureEditableSession() || !currentTemplate.value) {
      return
    }

    const entity = currentTemplate.value.entities.find((item) => item.id === entityId)
    if (!entity || !entity.vertices[vertexIndex]) {
      return
    }

    entity.vertices[vertexIndex] = point
    currentTemplate.value.updatedAt = timestamp()
    touchProject()
    queueSave()
  }

  function translateEntity(entityId: string, delta: GridPoint) {
    if (!ensureEditableSession() || !currentTemplate.value) {
      return
    }

    const entity = currentTemplate.value.entities.find((item) => item.id === entityId)
    if (!entity) {
      return
    }

    entity.vertices = entity.vertices.map((vertex) => ({
      x: vertex.x + delta.x,
      y: vertex.y + delta.y,
    }))
    currentTemplate.value.updatedAt = timestamp()
    touchProject()
    queueSave()
  }

  function updateSelectedEntityVertex(
    vertexIndex: number,
    axis: 'x' | 'y',
    rawValue: number,
    unit: MeasurementUnit,
  ) {
    if (!ensureEditableSession() || !selectedEntity.value || Number.isNaN(rawValue)) {
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
    if (!ensureEditableSession() || !selectedEntity.value || !currentTemplate.value) {
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

  const draftStyle = computed(() => {
    if (toolMode.value === 'polygon' || toolMode.value === 'polyline') {
      return createDefaultEntityStyle('custom', toolMode.value)
    }

    return createDefaultEntityStyle('custom', 'point')
  })

  return {
    activeSaveId,
    activeView,
    assignTemplate,
    availableSaves,
    buildingHeight,
    cancelDraft,
    canEdit,
    cloneCurrentTemplate,
    commitDraft,
    createTemplate,
    currentTemplate,
    currentTemplateId,
    deleteSelectedEntity,
    draftStyle,
    draftVertices,
    editableMembership,
    facadeProjection,
    filteredTemplates,
    initialize,
    initialized,
    persist,
    project,
    projectMeta,
    refreshSaveLists,
    selectEntity,
    selectFloor,
    selectSide,
    selectedEntity,
    selectedEntityId,
    selectedFloor,
    selectedFloorId,
    selectedSide,
    setActiveView,
    setToolMode,
    stackedFloors,
    statusMessage,
    syncState,
    toolMode,
    translateEntity,
    updateFloorHeight,
    updateGridSettings,
    updateSelectedEntity,
    updateSelectedEntityVertex,
    updateVertex,
    addVertexToDraft,
    cleanup() {
      window.clearTimeout(saveTimer)
      if (syncState.value !== 'syncing' && hasUnsyncedChanges()) {
        void persist()
      }
    },
  }
})
