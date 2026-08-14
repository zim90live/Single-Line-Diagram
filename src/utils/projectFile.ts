import { parseProjectDocument, type ProjectDocument } from '../domain/project'
import { symbolAssets } from '../editor/symbolCatalog'

export function serializeProject(document: ProjectDocument) {
  return JSON.stringify(document, null, 2)
}

export function parseProjectText(text: string) {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON，请检查文件内容后重试。')
  }

  try {
    return parseProjectDocument(json, symbolAssets)
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`项目文件校验失败：${error.message}`)
    }
    throw new Error('项目文件校验失败，请确认文件版本和内容。')
  }
}

export function downloadProject(document: ProjectDocument) {
  const blob = new Blob([serializeProject(document)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = documentObject().createElement('a')
  const safeName = document.project.name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'aidc-project'
  anchor.href = url
  anchor.download = `${safeName}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function documentObject() {
  return window.document
}
