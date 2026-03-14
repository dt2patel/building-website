# Planner Editor Test Plan

## Scope

This plan targets the editor flows most likely to corrupt user intent:

- Drawing new points, polylines, and polygons
- Creating and assigning new templates
- Selecting and editing entities after drawing
- Switching layers, floors, and template assignments while a draft exists
- Basic regression coverage for persistence and production buildability

## High-Risk Behaviors

1. New template creation does not become the active template for the current floor/layer.
2. Drawing on an unassigned layer mutates a fallback template instead of creating a working template.
3. Completing a draw leaves the editor in draw mode, preventing normal selection behavior.
4. Cross-layer selection leaves stale draft state behind.
5. Template reassignment leaves stale selection or draft state attached to the wrong template.

## Automated Coverage

### Store Workflow Tests

File: `src/stores/plannerStore.test.ts`

- Creates a new template and verifies it is immediately assigned to the active floor/layer.
- Unassigns a layer and verifies there is no active template fallback.
- Draws on an unassigned layer and verifies a new working template is created and assigned.
- Commits a polygon draft and verifies the entity is selected and the tool returns to `select`.
- Selects an entity on another layer during an in-progress draft and verifies the draft is cleared.

### Existing Regression Tests

- `src/config/seedProject.test.ts`
- `src/lib/geometry.test.ts`

These continue to guard seed data shape and grid snapping behavior.

## Manual Sanity Checklist

Run these in the app before release:

1. Create a new template on a layer that already has one assigned and confirm the dropdown switches to the new template immediately.
2. Draw a point, polyline, and polygon and confirm each new entity is selected after commit.
3. After each draw, click another entity and confirm selection works without manually toggling tools.
4. Clear a template assignment for a layer, draw a new entity, and confirm a new working template is created instead of modifying a shared template.
5. Start a draft, switch layers, and confirm the draft is cancelled.
6. Start a draft, change the active template for the same layer, and confirm the draft is cancelled.
7. Select an entity from a non-active layer and confirm the active layer switches to that entity's layer.
8. Edit selected entity vertices in the inspector and confirm the canvas updates.
9. Delete a selected entity and confirm the inspector clears.
10. Run PDF export once to confirm no runtime regression in the export flow.

## Executed This Pass

- `npm test`
- `npm run build`

Result: passing after fixing the planner store workflow bugs above.
