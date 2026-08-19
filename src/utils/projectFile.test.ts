import { describe, expect, it } from 'vitest'

import { createDefaultProject } from '../domain/project'
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
})
