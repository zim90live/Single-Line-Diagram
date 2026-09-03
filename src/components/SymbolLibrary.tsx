import { memo } from 'react'

import { SymbolBrowser } from './SymbolBrowser'
import { Pressable } from './ui'

interface SymbolLibraryProps {
  onInsert: (symbolKey: string) => void
  onEdit: (symbolKey: string) => void
  onInsertBusbar: () => void
  canInsertBusbar: boolean
}

export const SymbolLibrary = memo(function SymbolLibrary({
  onInsert,
  onEdit,
  onInsertBusbar,
  canInsertBusbar,
}: SymbolLibraryProps) {
  return (
    <section className="sidebar-section symbol-section" aria-labelledby="workspace-symbol-title">
      <SymbolBrowser
        idPrefix="workspace"
        mode="insert"
        onInsert={onInsert}
        onEdit={onEdit}
      />
      <section className="line-tool-browser" aria-labelledby="workspace-line-tool-title">
        <div className="panel-heading">
          <h2 id="workspace-line-tool-title">线路工具</h2>
          <span>1 个</span>
        </div>
        <p className="symbol-help">
          {canInsertBusbar ? '拖入画布，或双击插入当前视口中心' : '母线仅可用于电力图纸'}
        </p>
        <div className="symbol-grid">
          <div
            className="symbol-tile busbar-tool"
            data-mode="insert"
            data-disabled={!canInsertBusbar || undefined}
            draggable={canInsertBusbar}
            onDragStart={canInsertBusbar ? (event) => {
              event.dataTransfer.setData('application/x-aidc-busbar', 'electrical')
              event.dataTransfer.effectAllowed = 'copy'
            } : undefined}
          >
            <Pressable
              className="symbol-tile__primary"
              disabled={!canInsertBusbar}
              onDoubleClick={canInsertBusbar ? onInsertBusbar : undefined}
              onKeyDown={canInsertBusbar ? (event) => {
                if (event.key === 'Enter') onInsertBusbar()
              } : undefined}
              title={canInsertBusbar ? '拖动或双击插入母线' : '母线仅可用于电力图纸'}
            >
              <span className="busbar-tool__glyph" aria-hidden="true"><span /></span>
              <span>母线</span>
            </Pressable>
          </div>
        </div>
      </section>
    </section>
  )
})
