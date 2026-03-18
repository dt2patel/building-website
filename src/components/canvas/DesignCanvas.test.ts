import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { entityCenter, pointsToPath, snapToGrid } from '../../lib/geometry'
import type { PlanEntity } from '../../types/planner'
import DesignCanvas from './DesignCanvas.vue'
import type { DesignCanvasProps } from './designCanvas'

function createPolygonEntity(): PlanEntity {
  return {
    id: 'poly-1',
    layerType: 'perimeter',
    geometryType: 'polygon',
    label: 'Polygon',
    description: '',
    vertices: [
      { x: 1, y: 1 },
      { x: 4, y: 1 },
      { x: 4, y: 3 },
    ],
    style: {
      stroke: '#111827',
      fill: '#11182733',
      strokeWidth: 0.28,
      opacity: 1,
    },
    metadata: {},
  }
}

function createPointEntity(): PlanEntity {
  return {
    id: 'point-1',
    layerType: 'custom',
    geometryType: 'point',
    label: 'Marker',
    description: '',
    vertices: [{ x: 2, y: 3 }],
    style: {
      stroke: '#1d4ed8',
      fill: '#93c5fd',
      strokeWidth: 0.28,
      opacity: 1,
    },
    metadata: {},
  }
}

function createProps(overrides: Partial<DesignCanvasProps> = {}): DesignCanvasProps {
  return {
    headerEyebrow: 'Canvas',
    headerTitle: 'Shared Canvas',
    hoverEmptyLabel: 'Hover the canvas',
    editable: true,
    toolMode: 'select',
    selectedEntityId: null,
    draftStyle: {
      stroke: '#111827',
      fill: '#11182722',
      strokeWidth: 0.7,
      opacity: 1,
    },
    draftVertices: [],
    viewBoxGeometry: {
      minX: 0,
      minY: 0,
      width: 10,
      height: 10,
    },
    grid: {
      spacing: 1,
      unit: 'm',
      rect: {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
    },
    entities: [],
    screenToWorld: (event) => ({
      x: event.clientX / 10,
      y: event.clientY / 10,
    }),
    worldToSvg: (point) => point,
    ...overrides,
  }
}

function mountCanvas(overrides: Partial<DesignCanvasProps> = {}) {
  const wrapper = mount(DesignCanvas, {
    props: createProps(overrides),
  })
  const svg = wrapper.find('svg').element as SVGSVGElement

  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 100,
    bottom: 100,
    width: 100,
    height: 100,
    toJSON: () => ({}),
  })

  return wrapper
}

function dispatchPointerEvent(
  element: Element,
  type: string,
  init: MouseEventInit & { pointerId?: number } = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  })

  if (typeof init.pointerId === 'number') {
    Object.defineProperty(event, 'pointerId', {
      configurable: true,
      value: init.pointerId,
    })
  }

  element.dispatchEvent(event)
}

describe('DesignCanvas', () => {
  it('emits addVertex when clicking empty canvas in drawing mode', async () => {
    const wrapper = mountCanvas({
      toolMode: 'polygon',
    })

    await wrapper.find('svg').trigger('click', {
      clientX: 20,
      clientY: 40,
    })

    expect(wrapper.emitted('addVertex')).toEqual([
      [{ x: 2, y: 4 }],
    ])
  })

  it('does not emit addVertex while in select mode', async () => {
    const wrapper = mountCanvas({
      toolMode: 'select',
    })

    await wrapper.find('svg').trigger('click', {
      clientX: 20,
      clientY: 40,
    })

    expect(wrapper.emitted('addVertex')).toBeUndefined()
  })

  it('emits planner-style selection payloads for entity clicks', async () => {
    const entity = createPolygonEntity()
    const wrapper = mountCanvas({
      entities: [
        {
          entity,
          selectionLayerType: 'perimeter',
          showLabel: true,
        },
      ],
    })

    await wrapper.find('.shape').trigger('click')

    expect(wrapper.emitted('selectEntity')).toEqual([
      [{ entityId: entity.id, layerType: 'perimeter' }],
    ])
  })

  it('emits translateEntity with world-space deltas while dragging entities', async () => {
    const entity = createPolygonEntity()
    const wrapper = mountCanvas({
      entities: [{ entity }],
    })
    const shape = wrapper.find('.shape')

    ;(shape.element as SVGPathElement).setPointerCapture = vi.fn()

    dispatchPointerEvent(shape.element, 'pointerdown', {
      clientX: 10,
      clientY: 20,
      pointerId: 1,
    })
    dispatchPointerEvent(wrapper.find('svg').element, 'pointermove', {
      clientX: 30,
      clientY: 50,
      pointerId: 1,
    })

    expect(wrapper.emitted('translateEntity')).toEqual([
      [entity.id, { x: 2, y: 3 }],
    ])
  })

  it('emits updateVertex with transformed coordinates while dragging vertex handles', async () => {
    const entity = createPolygonEntity()
    const wrapper = mountCanvas({
      entities: [{ entity }],
      selectedEntityId: entity.id,
    })
    const handle = wrapper.find('.vertex-handle')

    ;(handle.element as SVGCircleElement).setPointerCapture = vi.fn()

    dispatchPointerEvent(handle.element, 'pointerdown', {
      pointerId: 9,
    })
    dispatchPointerEvent(wrapper.find('svg').element, 'pointermove', {
      clientX: 40,
      clientY: 60,
      pointerId: 9,
    })

    expect(wrapper.emitted('updateVertex')).toEqual([
      [entity.id, 0, { x: 4, y: 6 }],
    ])
  })

  it('suppresses selection clicks immediately after an entity drag', async () => {
    const entity = createPolygonEntity()
    const wrapper = mountCanvas({
      entities: [{ entity }],
    })
    const shape = wrapper.find('.shape')

    ;(shape.element as SVGPathElement).setPointerCapture = vi.fn()

    dispatchPointerEvent(shape.element, 'pointerdown', {
      clientX: 10,
      clientY: 20,
      pointerId: 1,
    })
    dispatchPointerEvent(wrapper.find('svg').element, 'pointermove', {
      clientX: 30,
      clientY: 50,
      pointerId: 1,
    })
    dispatchPointerEvent(wrapper.find('svg').element, 'pointerup', {
      pointerId: 1,
    })
    await shape.trigger('click')

    expect(wrapper.emitted('selectEntity')).toBeUndefined()
  })

  it('renders floor-mode polygon geometry without changing coordinates', () => {
    const entity = createPolygonEntity()
    const wrapper = mountCanvas({
      entities: [{ entity, showLabel: true }],
    })

    expect(wrapper.find('.shape').attributes('d')).toBe(pointsToPath(entity.vertices, true))
  })

  it('renders exterior-mode geometry, labels, and draft handles with flipped Y coordinates', () => {
    const entity = createPolygonEntity()
    const draftVertices = [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]
    const worldToSvg = (point: { x: number; y: number }) => ({
      x: point.x,
      y: 10 - point.y,
    })
    const wrapper = mountCanvas({
      entities: [{ entity, showLabel: true }],
      selectedEntityId: entity.id,
      draftVertices,
      toolMode: 'polyline',
      worldToSvg,
    })
    const transformedVertices = entity.vertices.map(worldToSvg)
    const transformedCenter = worldToSvg(entityCenter(entity))

    expect(wrapper.find('.shape').attributes('d')).toBe(pointsToPath(transformedVertices, true))
    expect(wrapper.find('.entity-label').attributes('y')).toBe(String(transformedCenter.y - 0.45))
    expect(wrapper.findAll('.vertex-handle')[0]?.attributes('cy')).toBe('9')
    expect(wrapper.find('.draft-shape').attributes('d')).toBe(pointsToPath(draftVertices.map(worldToSvg)))
    expect(wrapper.findAll('.draft-layer .vertex-handle')).toHaveLength(2)
  })

  it('renders point entities with the shared circle-and-cross symbol', () => {
    const entity = createPointEntity()
    const wrapper = mountCanvas({
      entities: [{ entity }],
      worldToSvg: (point) => ({
        x: point.x,
        y: 10 - point.y,
      }),
    })

    expect(wrapper.find('.point-symbol circle').exists()).toBe(true)
    expect(wrapper.find('.point-cross').attributes('d')).toContain('M 1.66 7')
    expect(wrapper.find('.point-cross').attributes('d')).toContain('L 2.34 7')
  })

  it('offsets the grid pattern to match transformed world-space snap points', () => {
    const wrapper = mountCanvas({
      grid: {
        spacing: 1,
        unit: 'm',
        rect: {
          x: 0,
          y: 0,
          width: 10,
          height: 3.2,
        },
      },
      worldToSvg: (point) => ({
        x: point.x,
        y: 3.2 - point.y,
      }),
    })

    const pattern = wrapper.find('pattern')

    expect(pattern.attributes('x')).toBe('0')
    expect(pattern.attributes('y')).toBe('0.20000000000000018')
  })

  it('zooms the visible viewBox without changing the viewport size', async () => {
    const wrapper = mountCanvas()
    const svg = wrapper.find('svg')

    expect(svg.attributes('viewBox')).toBe('0 0 10 10')

    await wrapper.findAll('.editor-stage__zoom-button')[1]?.trigger('click')

    expect(svg.attributes('viewBox')).toBe('1.6666666666666665 1.6666666666666665 6.666666666666667 6.666666666666667')

    await wrapper.find('.editor-stage__zoom-fit').trigger('click')

    expect(svg.attributes('viewBox')).toBe('0 0 10 10')
  })

  it('pans around the zoomed view when pan mode is enabled', async () => {
    const wrapper = mountCanvas()
    const svg = wrapper.find('svg')

    ;(svg.element as SVGSVGElement).setPointerCapture = vi.fn()

    await wrapper.findAll('.editor-stage__zoom-button')[1]?.trigger('click')
    await wrapper.find('.editor-stage__pan-toggle').trigger('click')

    dispatchPointerEvent(svg.element, 'pointerdown', {
      clientX: 50,
      clientY: 50,
      pointerId: 4,
    })
    dispatchPointerEvent(svg.element, 'pointermove', {
      clientX: 40,
      clientY: 40,
      pointerId: 4,
    })
    await wrapper.vm.$nextTick()

    expect(svg.attributes('viewBox')).toBe('2.3333333333333335 2.3333333333333335 6.666666666666667 6.666666666666667')
  })

  it('places points on the cursor-selected grid intersection after zoom and pan', async () => {
    const wrapper = mountCanvas({
      toolMode: 'point',
      screenToWorld: (event, svg, geometry) => {
        const rect = svg.getBoundingClientRect()
        const rawX = ((event.clientX - rect.left) / rect.width) * geometry.width + geometry.minX
        const rawY = ((event.clientY - rect.top) / rect.height) * geometry.height + geometry.minY

        return snapToGrid({ x: rawX, y: rawY }, 1, 'm')
      },
    })
    const svg = wrapper.find('svg')

    ;(svg.element as SVGSVGElement).setPointerCapture = vi.fn()

    await wrapper.findAll('.editor-stage__zoom-button')[1]?.trigger('click')
    await wrapper.find('.editor-stage__pan-toggle').trigger('click')
    dispatchPointerEvent(svg.element, 'pointerdown', {
      clientX: 50,
      clientY: 50,
      pointerId: 7,
    })
    dispatchPointerEvent(svg.element, 'pointermove', {
      clientX: 40,
      clientY: 40,
      pointerId: 7,
    })
    await wrapper.vm.$nextTick()
    await wrapper.find('.editor-stage__pan-toggle').trigger('click')
    await svg.trigger('click', {
      clientX: 55,
      clientY: 55,
    })

    expect(wrapper.emitted('addVertex')).toEqual([
      [{ x: 6, y: 6 }],
    ])
  })

  it('uses the editor-approved dash pattern for dashed polylines', () => {
    const entity = {
      ...createPolygonEntity(),
      id: 'line-1',
      geometryType: 'polyline' as const,
      vertices: [
        { x: 1, y: 1 },
        { x: 4, y: 3 },
      ],
      style: {
        ...createPolygonEntity().style,
        dashed: true,
      },
    }
    const wrapper = mountCanvas({
      entities: [{ entity }],
    })

    expect(wrapper.find('.shape--polyline').attributes('style')).toContain('stroke-dasharray: 2 1.4;')
  })

  it('exposes the backing svg element for floor export flows', () => {
    const wrapper = mountCanvas()

    expect(
      (wrapper.vm as { getSvgElement: () => SVGSVGElement | null }).getSvgElement(),
    ).toBe(wrapper.find('svg').element)
  })
})
