import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { exportFloorPdf } from '../lib/export'
import {
  createDefaultEntityStyle,
  entityLabel,
  timestamp,
} from '../lib/plannerModel'
import { cloneJson, fromDisplayValue } from '../lib/geometry'
import { useAuthStore } from './authStore'
import { isFirebaseConfigured } from '../services/firebase'
import {
  archiveSave,
  cacheProjectStateLocally,
  createSaveFromSource,
  loadProjectMeta,
  loadSave,
  loadSaves,
  saveActiveProjectState,
  setLastOpenedSave,
  uploadExport,
} from '../services/plannerRepository'
import {
  layerOrder,
  type GridPoint,
  type LayerType,
  type MeasurementUnit,
  type PlanEntity,
  type Project,
  type ProjectMeta,
  type ProjectSaveSummary,
  type SyncState,
  type Template,
  type ToolMode,
} from '../types/planner'

export const usePlannerStore = defineStore('planner', () => {
  const auth = useAuthStore()
  const firebaseEnabled = isFirebaseConfigured()
  const project = ref<Project | null>(null)
  const projectMeta = ref<ProjectMeta | null>(null)
  const activeSaveId = ref('')
  const availableSaves = ref<ProjectSaveSummary[]>([])
  const archivedSaves = ref<ProjectSaveSummary[]>([])
  const selectedFloorId = ref('')
  const activeLayerType = ref<LayerType>('perimeter')
  const selectedEntityId = ref<string | null>(null)
  const toolMode = ref<ToolMode>('select')
  const draftVertices = ref<GridPoint[]>([])
  const syncState = ref<SyncState>('local')
  const statusMessage = ref('Select a project save to start editing')
  const initialized = ref(false)
  const layerVisibility = ref<Record<LayerType, boolean>>({
    perimeter: true,
    structural: true,
    plumbing: true,
    fireSafety: true,
    electrical: true,
    custom: true,
  })
  const editableMembership = ref(false)

  let saveTimer: number | undefined
  const liveConnectionVerified = ref(false)
  const lastSyncedProject = ref<Project | null>(null)
  const currentProjectId = ref('')
  const currentContextKey = ref('')

  const selectedFloor = computed(
    () => project.value?.floors.find((floor) => floor.id === selectedFloorId.value) ?? project.value?.floors[0],
  )

  const currentTemplateId = computed(
    () => selectedFloor.value?.templateAssignments[activeLayerType.value] ?? null,
  )

  const currentTemplate = computed(
    () =>
      project.value?.templates.find((template) => template.id === currentTemplateId.value) ?? null,
  )

  const selectedEntity = computed(
    () => currentTemplate.value?.entities.find((entity) => entity.id === selectedEntityId.value) ?? null,
  )

  const templatesByLayer = computed(() =>
    layerOrder.reduce(
      (accumulator, layerType) => {
        accumulator[layerType] = (project.value?.templates ?? []).filter((template) => template.layerType === layerType)
        return accumulator
      },
      {} as Record<LayerType, Template[]>,
    ),
  )

  const visibleTemplates = computed(() => {
    const floor = selectedFloor.value
    if (!floor || !project.value) {
      return []
    }

    return layerOrder
      .filter((layerType) => layerVisibility.value[layerType])
      .map((layerType) => floor.templateAssignments[layerType])
      .filter((templateId): templateId is string => Boolean(templateId))
      .map((templateId) => project.value?.templates.find((template) => template.id === templateId))
      .filter((template): template is Template => Boolean(template))
  })

  const canEdit = computed(() => editableMembership.value && firebaseEnabled)

  function clearEditorSelection() {
    selectedEntityId.value = null
    draftVertices.value = []
    toolMode.value = 'select'
  }

  function lockEditingStatus(message: string) {
    liveConnectionVerified.value = false
    syncState.value = firebaseEnabled ? 'error' : 'local'
    statusMessage.value = message
    clearEditorSelection()
  }

  async function refreshSaveLists() {
    if (!currentProjectId.value) {
      availableSaves.value = []
      archivedSaves.value = []
      return
    }

    const [active, archived, meta] = await Promise.all([
      loadSaves(currentProjectId.value, { archived: false }),
      loadSaves(currentProjectId.value, { archived: true }),
      loadProjectMeta(currentProjectId.value),
    ])

    availableSaves.value = active
    archivedSaves.value = archived
    projectMeta.value = meta
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
      liveConnectionVerified.value = false
      return
    }

    liveConnectionVerified.value = true
    syncState.value = 'synced'
    statusMessage.value = 'Loaded from Firebase'
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

  async function persist() {
    if (!project.value) {
      return
    }

    if (!firebaseEnabled) {
      lockEditingStatus('Firebase config missing. Editing is locked.')
      return
    }

    syncState.value = 'syncing'
    statusMessage.value = 'Syncing live changes to Firebase...'

    try {
      await saveActiveProjectState(
        lastSyncedProject.value,
        project.value,
        {
          projectId: currentProjectId.value,
          saveId: activeSaveId.value,
          userId: auth.currentUid ?? undefined,
        },
      )
      lastSyncedProject.value = cloneJson(project.value)
      liveConnectionVerified.value = true
      syncState.value = 'synced'
      statusMessage.value = 'Synced to Firebase'
      await refreshSaveLists()
    } catch (error) {
      lockEditingStatus(error instanceof Error ? error.message : 'Unable to persist planner state')
    }
  }

  async function createSaveAs(name?: string) {
    if (!project.value || !auth.currentUid) {
      return null
    }

    if (!ensureEditableSession()) {
      return null
    }

    await persist()
    const saveId = await createSaveFromSource({
      projectId: currentProjectId.value,
      sourceSaveId: activeSaveId.value,
      name,
      creatorUid: auth.currentUid,
    })
    await refreshSaveLists()
    return saveId
  }

  async function setSaveArchived(saveId: string, archived: boolean) {
    if (!projectMeta.value) {
      return null
    }

    if (!ensureEditableSession()) {
      return null
    }

    await archiveSave(currentProjectId.value, saveId, archived)
    await refreshSaveLists()

    if (archived && saveId === activeSaveId.value && projectMeta.value.defaultSaveId !== saveId) {
      return projectMeta.value.defaultSaveId
    }

    return null
  }

  function selectFloor(floorId: string) {
    selectedFloorId.value = floorId
    clearEditorSelection()
  }

  function setActiveLayer(layerType: LayerType) {
    activeLayerType.value = layerType
    clearEditorSelection()
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
      clearEditorSelection()
    }
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

  function updatePlotVertex(
    vertexIndex: number,
    axis: 'x' | 'y',
    rawValue: number,
    unit: MeasurementUnit,
  ) {
    if (!ensureEditableSession() || !project.value) {
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
    if (!ensureEditableSession() || !project.value) {
      return
    }

    const layerType = activeLayerType.value
    const nextNumber = templatesByLayer.value[layerType].length + 1
    const name = `${layerType} concept ${nextNumber}`
    const template: Template = {
      id: `${layerType}-concept-${Date.now()}`,
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
    if (!ensureEditableSession() || !project.value || !currentTemplate.value) {
      return
    }

    const source = cloneJson(currentTemplate.value)
    const clonedName = `${source.name} copy`
    const template: Template = {
      ...source,
      id: `${source.id}-copy-${Date.now()}`,
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
    if (!ensureEditableSession() || !project.value) {
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
        style: createDefaultEntityStyle(activeLayerType.value, 'point'),
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
      style: createDefaultEntityStyle(activeLayerType.value, geometryType),
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

  function translateEntity(entityId: string, delta: GridPoint) {
    if (!ensureEditableSession()) {
      return
    }

    const template = visibleTemplates.value.find((item) => item.entities.some((entity) => entity.id === entityId))
    const entity = template?.entities.find((item) => item.id === entityId)
    if (!template || !entity) {
      return
    }

    entity.vertices = entity.vertices.map((vertex) => ({
      x: vertex.x + delta.x,
      y: vertex.y + delta.y,
    }))
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

  async function exportActiveFloor(svg: SVGSVGElement) {
    if (!project.value) {
      return
    }

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
    anchor.download = `${project.value.id}-${activeSaveId.value}-${floor.id}.pdf`
    anchor.click()
    URL.revokeObjectURL(downloadUrl)

    try {
      await uploadExport(project.value, floor.id, visibleLayers, activeSaveId.value)
      statusMessage.value = 'Export downloaded locally and logged to Firebase'
    } catch (error) {
      statusMessage.value = error instanceof Error ? error.message : 'Export logging failed'
    }
  }

  const draftStyle = computed(() => {
    if (toolMode.value === 'polygon' || toolMode.value === 'polyline') {
      return createDefaultEntityStyle(activeLayerType.value, toolMode.value)
    }

    return createDefaultEntityStyle(activeLayerType.value, 'point')
  })

  return {
    activeLayerType,
    activeSaveId,
    archivedSaves,
    assignTemplate,
    availableSaves,
    cancelDraft,
    canEdit,
    cloneCurrentTemplate,
    commitDraft,
    createSaveAs,
    createTemplate,
    currentProjectId,
    currentTemplate,
    currentTemplateId,
    deleteSelectedEntity,
    draftStyle,
    draftVertices,
    editableMembership,
    exportActiveFloor,
    initialize,
    initialized,
    layerVisibility,
    liveConnectionVerified,
    persist,
    project,
    projectMeta,
    refreshSaveLists,
    selectEntity,
    selectFloor,
    selectedEntity,
    selectedEntityId,
    selectedFloor,
    selectedFloorId,
    setActiveLayer,
    setSaveArchived,
    setToolMode,
    statusMessage,
    syncState,
    templatesByLayer,
    toggleLayerVisibility,
    toolMode,
    translateEntity,
    updateGridSettings,
    updatePlotVertex,
    updateSelectedEntity,
    updateSelectedEntityVertex,
    updateVertex,
    visibleTemplates,
    addVertexToDraft,
    cleanup() {
      window.clearTimeout(saveTimer)
    },
  }
})
