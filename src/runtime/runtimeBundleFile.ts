import type { DiagramRuntimeBundle } from './runtimeBundle'
import { serializeDiagramRuntimeBundle } from './runtimeBundle'

export function downloadDiagramRuntimeBundle(
  bundle: DiagramRuntimeBundle,
  fileName = bundle.source.projectName,
) {
  const blob = new Blob([serializeDiagramRuntimeBundle(bundle)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '-').trim() || 'aidc-runtime'
  anchor.href = url
  anchor.download = `${safeName}.runtime.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
