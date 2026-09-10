import { describe, expect, it } from 'vitest'
import { connectionEdgeSchema, createDefaultProject, parseProjectDocument, SCHEMA_VERSION } from './project'

describe('electrical child-line width persistence', () => {
  it('preserves custom widths and rejects invalid values', () => {
    const edge = { id: 'edge', sourceNodeId: 'a', targetNodeId: 'b', lineWidth: 4.5 }
    expect(connectionEdgeSchema.parse(JSON.parse(JSON.stringify(edge))).lineWidth).toBe(4.5)
    for (const lineWidth of [0, -1, 13, NaN]) {
      expect(connectionEdgeSchema.safeParse({ ...edge, lineWidth }).success).toBe(false)
    }
    expect(connectionEdgeSchema.parse({ ...edge, lineWidth: undefined }).lineWidth).toBeUndefined()
  })
  it('continues accepting v42 projects', () => {
    const project = createDefaultProject('旧项目', [])
    expect(parseProjectDocument({ ...project, schemaVersion: 42 }).schemaVersion).toBe(SCHEMA_VERSION)
  })
})
