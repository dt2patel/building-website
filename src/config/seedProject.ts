import {
  createEmptyAssignments,
  layerColors,
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
      strokeWidth: 0.8,
      opacity: 0.8,
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
      strokeWidth: 0.8,
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
      strokeWidth: 0.6,
      opacity: 1,
    },
    metadata: {},
  }
}

function buildFloors(): Floor[] {
  const baseAssignments = createEmptyAssignments()
  baseAssignments.structural = 'tpl-structural-master'
  baseAssignments.plumbing = 'tpl-plumbing-master'
  baseAssignments.fireSafety = 'tpl-fire-master'
  baseAssignments.electrical = 'tpl-electrical-master'
  baseAssignments.custom = 'tpl-custom-blank'

  const floorTypes: Floor['floorType'][] = [
    'garage',
    'garage',
    'garage',
    'office',
    'office',
    'office',
    'office',
    'office',
    'office',
    'office',
  ]

  return floorTypes.map((floorType, index) => ({
    id: `floor-${index + 1}`,
    name: `Floor ${index + 1}`,
    index: index + 1,
    floorType,
    templateAssignments: { ...baseAssignments },
  }))
}

function buildTemplates(timestamp: string): Template[] {
  const columns = [
    [22, 20],
    [40, 20],
    [58, 20],
    [76, 20],
    [94, 20],
    [22, 38],
    [40, 38],
    [58, 38],
    [76, 38],
    [94, 38],
    [22, 56],
    [40, 56],
    [58, 56],
    [76, 56],
    [94, 56],
  ].map(([x, y], index) =>
    point(`col-${index + 1}`, 'structural', `Column ${index + 1}`, { x, y }, 'column'),
  )

  return [
    {
      id: 'tpl-structural-master',
      name: 'Columns + walls',
      layerType: 'structural',
      version: 1,
      status: 'active',
      updatedAt: timestamp,
      entities: [
        ...columns,
        polyline('wall-corridor', 'structural', 'Main corridor wall', [
          { x: 16, y: 30 },
          { x: 104, y: 30 },
          { x: 104, y: 34 },
          { x: 16, y: 34 },
        ]),
        polygon(
          'meeting-shell',
          'structural',
          'Meeting room shell',
          [
            { x: 84, y: 44 },
            { x: 104, y: 44 },
            { x: 104, y: 62 },
            { x: 84, y: 62 },
          ],
          'rgba(29, 78, 216, 0.18)',
        ),
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
          { x: 64, y: 18 },
          { x: 64, y: 68 },
        ]),
        polyline('plumb-branch', 'plumbing', 'Branch to washroom block', [
          { x: 64, y: 44 },
          { x: 82, y: 44 },
          { x: 82, y: 52 },
        ]),
        polygon(
          'water-tank',
          'plumbing',
          'Utility water tank',
          [
            { x: 14, y: 58 },
            { x: 28, y: 58 },
            { x: 28, y: 72 },
            { x: 14, y: 72 },
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
          { x: 12, y: 14 },
          { x: 108, y: 14 },
          { x: 108, y: 76 },
          { x: 12, y: 76 },
          { x: 12, y: 14 },
        ]),
        polyline('sprinkler-main', 'fireSafety', 'Sprinkler main', [
          { x: 18, y: 50 },
          { x: 100, y: 50 },
        ], undefined, true),
        polygon(
          'fire-tank',
          'fireSafety',
          'Fire reserve tank',
          [
            { x: 92, y: 58 },
            { x: 106, y: 58 },
            { x: 106, y: 72 },
            { x: 92, y: 72 },
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
        point('panel-main', 'electrical', 'Main panel', { x: 18, y: 18 }, 'panel'),
        polyline('bus-trunk', 'electrical', 'Cable trunk', [
          { x: 18, y: 18 },
          { x: 18, y: 44 },
          { x: 92, y: 44 },
        ]),
        polyline('server-feed', 'electrical', 'Server room feed', [
          { x: 92, y: 44 },
          { x: 92, y: 60 },
          { x: 102, y: 60 },
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

export function createSeedProject(): Project {
  const timestamp = now()

  return {
    id: 'eklavya-blueprint-lab',
    name: 'Eklavya Blueprint Lab',
    units: 'ft',
    gridSpacing: 2,
    plotBoundary: [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 90 },
      { x: 0, y: 90 },
    ],
    buildingBoundary: [
      { x: 8, y: 10 },
      { x: 112, y: 10 },
      { x: 112, y: 80 },
      { x: 8, y: 80 },
    ],
    fixedStructures: [
      polygon(
        'fixed-stair-west',
        'structural',
        'West stair',
        [
          { x: 12, y: 24 },
          { x: 24, y: 24 },
          { x: 24, y: 40 },
          { x: 12, y: 40 },
        ],
        'rgba(46, 52, 64, 0.18)',
        '#384152',
      ),
      polygon(
        'fixed-lift-core',
        'structural',
        'Lift core',
        [
          { x: 52, y: 28 },
          { x: 68, y: 28 },
          { x: 68, y: 44 },
          { x: 52, y: 44 },
        ],
        'rgba(46, 52, 64, 0.18)',
        '#384152',
      ),
      polygon(
        'fixed-stair-east',
        'structural',
        'East stair',
        [
          { x: 96, y: 24 },
          { x: 108, y: 24 },
          { x: 108, y: 40 },
          { x: 96, y: 40 },
        ],
        'rgba(46, 52, 64, 0.18)',
        '#384152',
      ),
    ],
    floors: buildFloors(),
    templates: buildTemplates(timestamp),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
