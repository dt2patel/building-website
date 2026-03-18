import {
  createEmptyAssignments,
  createEmptyExteriorAssignments,
  layerColors,
  type CardinalSide,
  type ExteriorTemplate,
  type Floor,
  type GridPoint,
  type LayerType,
  type PlanEntity,
  type Project,
  type Template,
} from '../types/planner'

const now = () => new Date().toISOString()

function polygon(
  id: string,
  layerType: LayerType,
  label: string,
  vertices: GridPoint[],
  fill: string,
  stroke = layerColors[layerType],
): PlanEntity {
  return {
    id,
    layerType,
    geometryType: 'polygon',
    label,
    description: label,
    vertices,
    style: {
      stroke,
      fill,
      strokeWidth: layerType === 'perimeter' ? 0.28 : 0.38,
      opacity: layerType === 'perimeter' ? 1 : 0.82,
    },
    metadata: {},
  }
}

function polyline(
  id: string,
  layerType: LayerType,
  label: string,
  vertices: GridPoint[],
  stroke = layerColors[layerType],
  dashed = false,
): PlanEntity {
  return {
    id,
    layerType,
    geometryType: 'polyline',
    label,
    description: label,
    vertices,
    style: {
      stroke,
      fill: 'none',
      strokeWidth: 0.28,
      opacity: 0.95,
      dashed,
    },
    metadata: {},
  }
}

function point(
  id: string,
  layerType: LayerType,
  label: string,
  vertex: GridPoint,
  symbolKey: string,
  stroke = layerColors[layerType],
): PlanEntity {
  return {
    id,
    layerType,
    geometryType: 'point',
    label,
    description: label,
    symbolKey,
    vertices: [vertex],
    style: {
      stroke,
      fill: '#ffffff',
      strokeWidth: 0.22,
      opacity: 1,
    },
    metadata: {},
  }
}

function createColumnGrid() {
  const columnXs = [6.015, 12.265, 18.515, 24.765, 31.015]
  const columnYs = [11.365, 18.865, 26.365, 33.865, 41.365, 48.865, 56.365, 63.715]

  return columnYs.flatMap((y, rowIndex) =>
    columnXs.map((x, columnIndex) =>
      point(
        `col-${rowIndex + 1}-${columnIndex + 1}`,
        'structural',
        `Column ${rowIndex + 1}.${columnIndex + 1}`,
        { x, y },
        'column',
      ),
    ),
  )
}

function buildFloors(): Floor[] {
  const layouts = [
    { id: 'floor-ground', name: 'Ground Parking', floorType: 'garage' as const, perimeter: 'tpl-perimeter-ground' },
    { id: 'floor-podium', name: 'Podium Parking', floorType: 'garage' as const, perimeter: 'tpl-perimeter-podium' },
    { id: 'floor-01', name: 'First Floor', floorType: 'office' as const, perimeter: 'tpl-perimeter-office' },
    { id: 'floor-02', name: 'Second Floor', floorType: 'office' as const, perimeter: 'tpl-perimeter-office' },
    { id: 'floor-03', name: 'Third Floor', floorType: 'office' as const, perimeter: 'tpl-perimeter-office' },
    { id: 'floor-04', name: 'Fourth Floor', floorType: 'office' as const, perimeter: 'tpl-perimeter-office' },
    { id: 'floor-05', name: 'Fifth Floor', floorType: 'office' as const, perimeter: 'tpl-perimeter-office' },
    { id: 'floor-06', name: 'Sixth Floor', floorType: 'office' as const, perimeter: 'tpl-perimeter-office' },
    { id: 'floor-service', name: 'Service Floor', floorType: 'office' as const, perimeter: 'tpl-perimeter-service' },
    { id: 'floor-terrace', name: 'Terrace Floor', floorType: 'office' as const, perimeter: 'tpl-perimeter-terrace' },
  ]

  return layouts.map((layout, index) => {
    const assignments = createEmptyAssignments()
    assignments.perimeter = layout.perimeter
    assignments.structural = 'tpl-structural-columns'
    assignments.plumbing = 'tpl-plumbing-master'
    assignments.fireSafety = 'tpl-fire-master'
    assignments.electrical = 'tpl-electrical-master'
    assignments.custom = 'tpl-custom-blank'

    return {
      id: layout.id,
      name: layout.name,
      index: index + 1,
      floorType: layout.floorType,
      heightMeters: layout.floorType === 'garage' ? 3.5 : 3.2,
      templateAssignments: assignments,
      exterior: createEmptyExteriorAssignments(),
    }
  })
}

function buildTemplates(timestamp: string): Template[] {
  const columns = createColumnGrid()

  return [
    {
      id: 'tpl-perimeter-ground',
      name: 'Ground parking perimeter',
      layerType: 'perimeter',
      version: 1,
      status: 'active',
      updatedAt: timestamp,
      entities: [
        polygon(
          'per-ground',
          'perimeter',
          'Ground parking shell',
          [
            { x: 6, y: 6 },
            { x: 31, y: 6 },
            { x: 31, y: 66.85 },
            { x: 6, y: 66.85 },
          ],
          'rgba(55, 65, 81, 0.04)',
        ),
      ],
    },
    {
      id: 'tpl-perimeter-podium',
      name: 'Podium parking perimeter',
      layerType: 'perimeter',
      version: 1,
      status: 'active',
      updatedAt: timestamp,
      entities: [
        polygon(
          'per-podium',
          'perimeter',
          'Podium parking shell',
          [
            { x: 7.2, y: 6.25 },
            { x: 32.205, y: 6.25 },
            { x: 32.205, y: 64.05 },
            { x: 7.2, y: 64.05 },
          ],
          'rgba(55, 65, 81, 0.04)',
        ),
      ],
    },
    {
      id: 'tpl-perimeter-office',
      name: 'Office perimeter',
      layerType: 'perimeter',
      version: 1,
      status: 'active',
      updatedAt: timestamp,
      entities: [
        polygon(
          'per-office',
          'perimeter',
          'Office shell',
          [
            { x: 7.25, y: 6.1 },
            { x: 32.25, y: 6.1 },
            { x: 32.25, y: 66.95 },
            { x: 7.25, y: 66.95 },
            { x: 7.25, y: 13.6 },
            { x: 18.9, y: 13.6 },
            { x: 18.9, y: 6.1 },
          ],
          'rgba(55, 65, 81, 0.04)',
        ),
      ],
    },
    {
      id: 'tpl-perimeter-service',
      name: 'Service floor perimeter',
      layerType: 'perimeter',
      version: 1,
      status: 'active',
      updatedAt: timestamp,
      entities: [
        polygon(
          'per-service',
          'perimeter',
          'Service shell',
          [
            { x: 7.25, y: 6.1 },
            { x: 32.25, y: 6.1 },
            { x: 32.25, y: 66.95 },
            { x: 7.25, y: 66.95 },
          ],
          'rgba(55, 65, 81, 0.04)',
        ),
      ],
    },
    {
      id: 'tpl-perimeter-terrace',
      name: 'Terrace perimeter',
      layerType: 'perimeter',
      version: 1,
      status: 'active',
      updatedAt: timestamp,
      entities: [
        polygon(
          'per-terrace',
          'perimeter',
          'Terrace shell',
          [
            { x: 7.25, y: 6.1 },
            { x: 32.25, y: 6.1 },
            { x: 32.25, y: 66.95 },
            { x: 7.25, y: 66.95 },
          ],
          'rgba(55, 65, 81, 0.04)',
        ),
      ],
    },
    {
      id: 'tpl-structural-columns',
      name: 'Column grid',
      layerType: 'structural',
      version: 1,
      status: 'active',
      updatedAt: timestamp,
      entities: [
        ...columns,
        polyline('central-stair', 'structural', 'Central stair / ramp block', [
          { x: 11.1, y: 16.2 },
          { x: 16.5, y: 16.2 },
          { x: 16.5, y: 42.2 },
          { x: 11.1, y: 42.2 },
          { x: 11.1, y: 16.2 },
        ]),
      ],
    },
    {
      id: 'tpl-plumbing-master',
      name: 'Wet core + tank',
      layerType: 'plumbing',
      version: 1,
      status: 'active',
      updatedAt: timestamp,
      entities: [
        polyline('plumb-stack', 'plumbing', 'Wet wall main', [
          { x: 13.8, y: 18.0 },
          { x: 13.8, y: 60.5 },
        ]),
        polyline('plumb-branch', 'plumbing', 'Branch to washroom block', [
          { x: 13.8, y: 44.0 },
          { x: 22.4, y: 44.0 },
          { x: 22.4, y: 51.2 },
        ]),
        polygon(
          'water-tank',
          'plumbing',
          'Domestic water tank',
          [
            { x: 19.4, y: 6.8 },
            { x: 25.4, y: 6.8 },
            { x: 25.4, y: 12.8 },
            { x: 19.4, y: 12.8 },
          ],
          'rgba(15, 118, 110, 0.18)',
        ),
      ],
    },
    {
      id: 'tpl-fire-master',
      name: 'Fire loop + tank',
      layerType: 'fireSafety',
      version: 1,
      status: 'active',
      updatedAt: timestamp,
      entities: [
        polyline('fire-loop', 'fireSafety', 'Perimeter fire loop', [
          { x: 7.4, y: 6.4 },
          { x: 32.0, y: 6.4 },
          { x: 32.0, y: 66.6 },
          { x: 7.4, y: 66.6 },
          { x: 7.4, y: 6.4 },
        ]),
        polyline('sprinkler-main', 'fireSafety', 'Sprinkler main', [
          { x: 10.0, y: 34.2 },
          { x: 30.0, y: 34.2 },
        ], undefined, true),
        polygon(
          'fire-tank',
          'fireSafety',
          'Fire reserve tank',
          [
            { x: 26.7, y: 60.4 },
            { x: 31.0, y: 60.4 },
            { x: 31.0, y: 66.2 },
            { x: 26.7, y: 66.2 },
          ],
          'rgba(185, 28, 28, 0.18)',
        ),
      ],
    },
    {
      id: 'tpl-electrical-master',
      name: 'Electrical backbone',
      layerType: 'electrical',
      version: 1,
      status: 'active',
      updatedAt: timestamp,
      entities: [
        point('panel-main', 'electrical', 'Main panel', { x: 8.4, y: 59.4 }, 'panel'),
        polyline('bus-trunk', 'electrical', 'Cable trunk', [
          { x: 8.4, y: 59.4 },
          { x: 8.4, y: 16.0 },
          { x: 28.6, y: 16.0 },
        ]),
        polyline('server-feed', 'electrical', 'Server room feed', [
          { x: 28.6, y: 16.0 },
          { x: 28.6, y: 9.2 },
          { x: 19.8, y: 9.2 },
        ]),
      ],
    },
    {
      id: 'tpl-custom-blank',
      name: 'Custom concepts',
      layerType: 'custom',
      version: 1,
      status: 'active',
      updatedAt: timestamp,
      entities: [],
    },
  ]
}

function buildExteriorTemplates(timestamp: string): ExteriorTemplate[] {
  const sides: CardinalSide[] = ['east', 'west', 'north', 'south']
  const heights = [
    { suffix: 'parking', heightMeters: 3.5 },
    { suffix: 'office', heightMeters: 3.2 },
  ]

  return sides.flatMap((side) =>
    heights.map((height) => ({
      id: `ext-${side}-${height.suffix}`,
      name: `${side[0].toUpperCase()}${side.slice(1)} ${height.suffix}`,
      side,
      heightMeters: height.heightMeters,
      version: 1,
      status: 'active' as const,
      updatedAt: timestamp,
      entities: [],
    })),
  )
}

export function createSeedProject(): Project {
  const timestamp = now()

  return {
    schemaVersion: 2,
    id: 'eklavya-blueprint-lab',
    name: 'Eklavya',
    units: 'm',
    gridUnit: 'm',
    gridSpacing: 1,
    plotBoundary: [
      { x: 0, y: 0 },
      { x: 40, y: -3 },
      { x: 40.462, y: 72.35 },
      { x: 0, y: 72.35 },
    ],
    buildingBoundary: [
      { x: 6, y: 6 },
      { x: 31, y: 6 },
      { x: 31, y: 66.85 },
      { x: 6, y: 66.85 },
    ],
    fixedStructures: [],
    floors: buildFloors(),
    templates: buildTemplates(timestamp),
    exteriorTemplates: buildExteriorTemplates(timestamp),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
