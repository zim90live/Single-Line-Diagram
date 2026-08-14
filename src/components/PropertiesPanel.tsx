import { MousePointer2, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { EDITOR_GRID_SIZE, type DiagramElement } from '../domain/project'
import {
  DEFAULT_CONFIGURABLE_SYMBOL_COLOR,
  getScaledSymbolSize,
  getSymbolScaleStep,
  normalizeSymbolColor,
  symbolsByKey,
} from '../editor/symbolCatalog'
import { Button, NumericField, TextField } from './ui'

interface PropertiesPanelProps {
  selectedElements: DiagramElement[]
  onPatch: (elementId: string, patch: Partial<DiagramElement>) => void
  onColorPreview: (elementId: string, color: string | null) => void
  onDelete: () => void
}

function CommittedTextField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string
  value: string
  placeholder?: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const next = draft.trim()
    if (next !== value) onCommit(next)
  }
  return (
    <TextField
      label={label}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function CommittedColorField({
  element,
  value,
  hasCustomColor,
  onPreview,
  onCommit,
  onRestore,
}: {
  element: DiagramElement
  value: string
  hasCustomColor: boolean
  onPreview: (elementId: string, color: string | null) => void
  onCommit: (color: string) => void
  onRestore: () => void
}) {
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(value)
  const committedRef = useRef(value)

  useEffect(() => {
    setDraft(value)
    draftRef.current = value
    committedRef.current = value
  }, [element.id, value])

  useEffect(() => () => onPreview(element.id, null), [element.id])

  const preview = (rawColor: string) => {
    const color = normalizeSymbolColor(rawColor)
    draftRef.current = color
    setDraft(color)
    onPreview(element.id, color)
    return color
  }

  const commit = (rawColor: string) => {
    const color = preview(rawColor)
    if (color === committedRef.current) {
      onPreview(element.id, null)
      return
    }
    committedRef.current = color
    onCommit(color)
  }

  return (
    <div className="property-color-field">
      <div className="property-color-field__heading">
        <span>图元颜色</span>
        {hasCustomColor ? (
          <Button
            variant="neutral-ghost"
            leadingIcon={<RotateCcw />}
            onClick={() => {
              onPreview(element.id, null)
              onRestore()
            }}
          >
            恢复默认
          </Button>
        ) : null}
      </div>
      <label className="property-color-field__control">
        <input
          aria-label="图元颜色"
          type="color"
          value={draft}
          onInput={(event) => preview(event.currentTarget.value)}
          onChange={(event) => {
            if (event.nativeEvent.type === 'change') commit(event.currentTarget.value)
          }}
          onBlur={() => commit(draftRef.current)}
        />
        <span
          className="property-color-field__swatch"
          style={{ backgroundColor: draft }}
          aria-hidden="true"
        />
        <code>{draft}</code>
      </label>
    </div>
  )
}

export function PropertiesPanel({
  selectedElements,
  onPatch,
  onColorPreview,
  onDelete,
}: PropertiesPanelProps) {
  if (selectedElements.length === 0) {
    return (
      <aside className="properties-panel" aria-labelledby="properties-title">
        <div className="panel-heading properties-heading">
          <h2 id="properties-title">属性</h2>
          <span>未选择</span>
        </div>
        <div className="properties-empty">
          <MousePointer2 aria-hidden="true" />
          <strong>选择一个图元查看属性</strong>
          <span>Shift 多选，拖动空白区域框选</span>
        </div>
      </aside>
    )
  }

  if (selectedElements.length > 1) {
    return (
      <aside className="properties-panel" aria-labelledby="properties-title">
        <div className="panel-heading properties-heading">
          <h2 id="properties-title">属性</h2>
          <span>{selectedElements.length} 个图元</span>
        </div>
        <div className="multi-selection-summary">
          <strong>已选择多个图元</strong>
          <p>可整体移动、缩放、旋转，或使用复制、删除和撤销命令。</p>
          <Button variant="danger-soft" leadingIcon={<Trash2 />} onClick={onDelete}>删除所选</Button>
        </div>
      </aside>
    )
  }

  const element = selectedElements[0]
  const symbol = symbolsByKey.get(element.assetKey)
  const scale = symbol ? element.width / symbol.intrinsicWidth : 1
  const scaleStep = symbol ? getSymbolScaleStep(symbol, EDITOR_GRID_SIZE) : 1
  const symbolColor = normalizeSymbolColor(element.properties.color)
  const hasCustomColor = typeof element.properties.color === 'string'
    && element.properties.color.toUpperCase() !== DEFAULT_CONFIGURABLE_SYMBOL_COLOR
  return (
    <aside className="properties-panel" aria-labelledby="properties-title">
      <div className="panel-heading properties-heading">
        <h2 id="properties-title">属性</h2>
        <span>单个图元</span>
      </div>
      <div className="property-form" key={element.id}>
        <CommittedTextField
          label="名称"
          value={element.name}
          onCommit={(name) => onPatch(element.id, { name: name || '未命名图元' })}
        />
        <CommittedTextField
          label="设备标识"
          value={String(element.properties.tag ?? '')}
          placeholder="例如 UPS-01"
          onCommit={(tag) => onPatch(element.id, { properties: { ...element.properties, tag } })}
        />
        {symbol?.configurableColor ? (
          <CommittedColorField
            element={element}
            value={symbolColor}
            hasCustomColor={hasCustomColor}
            onPreview={onColorPreview}
            onCommit={(color) => onPatch(element.id, {
              properties: { ...element.properties, color },
            })}
            onRestore={() => {
              const properties = { ...element.properties }
              delete properties.color
              onPatch(element.id, { properties })
            }}
          />
        ) : null}
        <div className="property-grid">
          <NumericField label="X" value={element.x} step={EDITOR_GRID_SIZE} onCommit={(x) => onPatch(element.id, { x })} />
          <NumericField label="Y" value={element.y} step={EDITOR_GRID_SIZE} onCommit={(y) => onPatch(element.id, { y })} />
          {symbol ? (
            <NumericField
              label="缩放"
              value={scale * 100}
              min={scaleStep * 100}
              step={scaleStep * 100}
              unit="%"
              onCommit={(percentage) => {
                const size = getScaledSymbolSize(symbol, percentage / 100, EDITOR_GRID_SIZE)
                onPatch(element.id, { width: size.width, height: size.height })
              }}
            />
          ) : null}
          <NumericField
            label="角度"
            value={element.rotation}
            min={-3600}
            max={3600}
            step={90}
            unit="°"
            onCommit={(rotation) => onPatch(element.id, { rotation })}
          />
        </div>
        <div className="property-meta">
          <span>尺寸</span>
          <code>{element.width} × {element.height}</code>
        </div>
        <div className="property-meta">
          <span>素材键</span><code>{element.assetKey}</code>
        </div>
        <Button variant="danger-soft" leadingIcon={<Trash2 />} onClick={onDelete}>删除图元</Button>
      </div>
    </aside>
  )
}
