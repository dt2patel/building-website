import { describe, expect, it } from 'vitest'
import { createSeedProject } from '../config/seedProject'
import { exportProjectJsonBlob, projectJsonFilename } from './export'

describe('project JSON export helpers', () => {
  it('serializes a project into downloadable JSON', async () => {
    const project = createSeedProject()
    project.id = 'project-1'
    project.name = 'Planner Test'

    const blob = exportProjectJsonBlob(project)
    const exported = JSON.parse(await blob.text())

    expect(blob.type).toBe('application/json')
    expect(exported).toEqual(project)
  })

  it('builds a save-specific filename', () => {
    const project = createSeedProject()
    project.id = 'project-1'

    expect(projectJsonFilename(project, 'save-default')).toBe('project-1-save-default.json')
  })
})
