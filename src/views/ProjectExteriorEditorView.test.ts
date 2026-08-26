import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ProjectExteriorEditorView from './ProjectExteriorEditorView.vue'

const routerPush = vi.fn()
const routerReplace = vi.fn()
const route = {
  params: {
    projectId: 'project-1',
    saveId: 'save-default',
  },
}

const exteriorStore = {
  initialize: vi.fn(async () => undefined),
  cleanup: vi.fn(),
  persist: vi.fn(),
  setActiveView: vi.fn(),
  setToolMode: vi.fn(),
  selectFloor: vi.fn(),
  selectSide: vi.fn(),
  assignTemplate: vi.fn(),
  createTemplate: vi.fn(),
  cloneCurrentTemplate: vi.fn(),
  addVertexToDraft: vi.fn(),
  translateEntity: vi.fn(),
  updateVertex: vi.fn(),
  deleteSelectedEntity: vi.fn(),
  updateSelectedEntity: vi.fn(),
  updateSelectedEntityVertex: vi.fn(),
  cancelDraft: vi.fn(),
  commitDraft: vi.fn(),
  activeSaveId: 'save-default',
  activeView: 'building' as const,
  availableSaves: [
    {
      id: 'save-default',
      name: 'Default Save',
    },
  ],
  buildingHeight: 3.5,
  canEdit: true,
  currentTemplate: null,
  currentTemplateId: null,
  draftStyle: {
    stroke: '#111827',
    fill: '#11182722',
    strokeWidth: 0.7,
    opacity: 1,
  },
  draftVertices: [],
  facadeProjection: null,
  filteredTemplates: [],
  project: {
    id: 'project-1',
    name: 'Planner Test',
    gridUnit: 'm' as const,
    gridSpacing: 1,
    floors: [
      {
        id: 'floor-ground',
        name: 'Ground Parking',
        index: 1,
        floorType: 'garage' as const,
        heightMeters: 3.5,
        templateAssignments: {
          perimeter: null,
          structural: null,
          plumbing: null,
          fireSafety: null,
          electrical: null,
          custom: null,
        },
        exterior: {
          east: null,
          west: null,
          north: null,
          south: null,
        },
      },
    ],
  },
  projectMeta: {
    id: 'project-1',
    name: 'Planner Test',
  },
  selectedEntity: null,
  selectedEntityId: null,
  selectedFloor: {
    id: 'floor-ground',
    name: 'Ground Parking',
    index: 1,
    floorType: 'garage' as const,
    heightMeters: 3.5,
    templateAssignments: {
      perimeter: null,
      structural: null,
      plumbing: null,
      fireSafety: null,
      electrical: null,
      custom: null,
    },
    exterior: {
      east: null,
      west: null,
      north: null,
      south: null,
    },
  },
  selectedFloorId: 'floor-ground',
  selectedSide: 'east' as const,
  stackedFloors: [
    {
      floor: {
        id: 'floor-ground',
        name: 'Ground Parking',
        index: 1,
        floorType: 'garage' as const,
        heightMeters: 3.5,
        templateAssignments: {
          perimeter: null,
          structural: null,
          plumbing: null,
          fireSafety: null,
          electrical: null,
          custom: null,
        },
        exterior: {
          east: null,
          west: null,
          north: null,
          south: null,
        },
      },
      bottomOffset: 0,
      projection: {
        side: 'east' as const,
        width: 10,
        height: 3.5,
        guides: [
          {
            id: 'guide-1',
            kind: 'column' as const,
            label: 'Column A',
            layerType: 'structural' as const,
            horizontalStart: 2,
            horizontalEnd: 2,
          },
        ],
      },
      template: null,
      isAssigned: false,
      entityCount: 0,
      guideCount: 1,
    },
  ],
  statusMessage: 'Loaded from Firebase',
  syncState: 'synced' as const,
  toolMode: 'select' as const,
  updateFloorHeight: vi.fn(),
  updateGridSettings: vi.fn(),
}

const projectsStore = {
  initialize: vi.fn(async () => undefined),
  projects: [
    {
      id: 'project-1',
      canEdit: true,
      defaultSaveId: 'save-default',
    },
  ],
  archivedProjects: [],
}

const authStore = {
  initialize: vi.fn(async () => undefined),
  firebaseEnabled: true,
}

vi.mock('@ionic/vue', async () => {
  const vue = await import('vue')

  const passthrough = vue.defineComponent({
    setup(_props, { slots }) {
      return () => vue.h('div', slots.default?.())
    },
  })

  return {
    IonContent: passthrough,
    IonPage: passthrough,
    onIonViewWillEnter: (callback: () => void | Promise<void>) => {
      void callback()
    },
    onIonViewWillLeave: () => undefined,
  }
})

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({
    push: routerPush,
    replace: routerReplace,
  }),
}))

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => authStore,
}))

vi.mock('../stores/projectsStore', () => ({
  useProjectsStore: () => projectsStore,
}))

vi.mock('../stores/exteriorPlannerStore', () => ({
  useExteriorPlannerStore: () => exteriorStore,
}))

vi.mock('../components/canvas/DesignCanvas.vue', () => ({
  default: {
    template: '<div data-test="design-canvas" />',
  },
}))

vi.mock('../components/exterior/WholeBuildingElevation.vue', () => ({
  default: {
    template: '<div data-test="whole-building-elevation" />',
  },
}))

describe('ProjectExteriorEditorView', () => {
  it('shows building review controls instead of floor editing tools in building mode', async () => {
    const wrapper = mount(ProjectExteriorEditorView)
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Clean')
    expect(wrapper.text()).toContain('Geometry')
    expect(wrapper.text()).toContain('Assigned only')
    expect(wrapper.text()).not.toContain('select')
    expect(wrapper.find('[data-test="whole-building-elevation"]').exists()).toBe(true)
  })

  it('opens the selected review floor from the building summary panel', async () => {
    const wrapper = mount(ProjectExteriorEditorView)
    await wrapper.vm.$nextTick()

    await wrapper.find('button.button--primary.review-summary__action').trigger('click')

    expect(exteriorStore.selectFloor).toHaveBeenCalledWith('floor-ground')
  })
})
