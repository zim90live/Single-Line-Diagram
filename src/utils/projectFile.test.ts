import { describe, expect, it } from 'vitest'

import { createDefaultProject, withOnOffStateSnapshot } from '../domain/project'
import { symbolAssets } from '../editor/symbolCatalog'
import { parseProjectText, serializeProject } from './projectFile'

describe('project file', () => {
  it('serializes and parses a project without loss', () => {
    const document = createDefaultProject('导入导出测试', symbolAssets)
    expect(parseProjectText(serializeProject(document))).toEqual(document)
  })

  it('returns a recoverable message for malformed JSON', () => {
    expect(() => parseProjectText('{bad json')).toThrow('不是有效的 JSON')
  })

  it('includes an explicit On/Off state in the exported JSON snapshot', () => {
    const document = createDefaultProject('开关状态导出', symbolAssets)
    document.elements = [{
      id: 'switch-export',
      diagramId: document.diagrams[0].id,
      assetKey: 'switch',
      name: 'Switch',
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      rotation: 0,
      properties: { tag: 'SW-EXPORT' },
      extensions: {},
    }]

    const serialized = serializeProject(withOnOffStateSnapshot(document, {
      'switch-export': true,
    }))

    expect(serialized).toContain('"onOffState": "on"')
    expect(parseProjectText(serialized).elements[0].onOffState).toBe('on')
  })
})
