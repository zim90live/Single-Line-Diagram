import { describe, expect, it } from 'vitest'
import { connectionNetworkSchema, createDefaultProject, parseProjectDocument } from '../domain/project'
import { circuitColor, circuitDisplayEdges, circuitKey, circuitPaletteStyle } from './circuitPalette'

const network = connectionNetworkSchema.parse({ id: 'net', diagramId: 'diagram', type: 'electrical',
  nodes: [{ id: 'a', kind: 'node', x: 0, y: 0 }, { id: 'b', kind: 'node', x: 8, y: 0 }],
  edges: [{ id: 'edge', sourceNodeId: 'a', targetNodeId: 'b', color: '#123456' }],
})

describe('project circuit palette', () => {
  it('binds assigned colors without overwriting unassigned custom colors', () => {
    const assets = new Map()
    expect(circuitDisplayEdges([network], [], assets).get('edge')?.color).toBe('#123456')
    const assigned = { ...network, powerSupplyChannel: 'a' as const }
    expect(circuitKey(assigned, [], assets)).toBe('a')
    expect(circuitDisplayEdges([assigned], [], assets).get('edge')?.color).toBe('#1BA4FF')
    expect(circuitDisplayEdges([assigned], [], assets, { a: '#ABCDEF' }).get('edge')?.color).toBe('#ABCDEF')
    expect(circuitDisplayEdges([{ ...assigned, powerSupplyChannel: undefined }], [], assets).get('edge')?.color).toBe('#123456')
    expect(assigned.edges[0].color).toBe('#123456')
  })
  it('uses the same cooling colors for lines and anchor variables', () => {
    const palette = { 'cooling-tertiary-cold': '#345678' }
    const cooling = { ...network, type: 'cooling-tertiary-cold' as const }
    expect(circuitDisplayEdges([cooling], [], new Map(), palette).get('edge')?.color).toBe('#345678')
    expect(circuitPaletteStyle(palette)).toHaveProperty('--cooling-tertiary-cold', '#345678')
    expect(circuitColor('b')).toBe('#00B387')
  })
  it('persists project palette and upgrades v38 without rewriting old colors', () => {
    const document = createDefaultProject()
    document.circuitPalette = { a: '#112233', 'cooling-tertiary-hot': '#445566' }
    expect(parseProjectDocument(JSON.parse(JSON.stringify(document))).circuitPalette).toEqual(document.circuitPalette)
    expect(parseProjectDocument({ ...createDefaultProject(), schemaVersion: 38 }).schemaVersion).toBe(document.schemaVersion)
    expect(() => parseProjectDocument({ ...document, circuitPalette: { a: 'red' } })).toThrow()
  })
})
