import { PencilLine, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { symbolCatalog } from '../scene/symbolCatalog'
import { IconButton, Pressable, TextField } from '@aidc/ui'

interface SymbolBrowserProps {
  idPrefix: string
  mode: 'insert' | 'select'
  selectedKey?: string
  onInsert?: (symbolKey: string) => void
  onSelect?: (symbolKey: string) => void
  onEdit?: (symbolKey: string) => void
}

export function SymbolBrowser({
  idPrefix,
  mode,
  selectedKey,
  onInsert,
  onSelect,
  onEdit,
}: SymbolBrowserProps) {
  const [query, setQuery] = useState('')
  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const symbols = normalized
      ? symbolCatalog.filter((symbol) =>
          `${symbol.name}${symbol.category}`.toLocaleLowerCase().includes(normalized),
        )
      : symbolCatalog
    return symbols.reduce<Record<string, typeof symbols>>((groups, symbol) => {
      groups[symbol.category] ??= []
      groups[symbol.category].push(symbol)
      return groups
    }, {})
  }, [query])

  const headingId = `${idPrefix}-symbol-title`
  const helpText = mode === 'insert'
    ? '拖入画布，或双击插入当前视口中心'
    : '单击图元切换锚点编辑对象'

  return (
    <section
      className="symbol-browser"
      data-mode={mode}
      aria-labelledby={headingId}
    >
      <div className="panel-heading">
        <h2 id={headingId}>图元素材</h2>
        <span>{symbolCatalog.length} 个</span>
      </div>
      <div className="symbol-search">
        <Search aria-hidden="true" />
        <TextField
          label="搜索图元"
          hideLabel
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索图元"
        />
      </div>
      <p className="symbol-help">{helpText}</p>
      <div className="symbol-groups">
        {Object.entries(filteredGroups).map(([category, symbols]) => (
          <div className="symbol-group" key={category}>
            <h3>{category}</h3>
            <div className="symbol-grid">
              {symbols.map((symbol) => {
                const selected = symbol.key === selectedKey
                return (
                  <div
                    className="symbol-tile"
                    data-mode={mode}
                    data-selected={selected || undefined}
                    key={symbol.key}
                    draggable={mode === 'insert'}
                    onDragStart={mode === 'insert' ? (event) => {
                      event.dataTransfer.setData('application/x-aidc-symbol', symbol.key)
                      event.dataTransfer.setData(`application/x-aidc-symbol-key--${symbol.key}`, '')
                      event.dataTransfer.effectAllowed = 'copy'
                    } : undefined}
                  >
                    <Pressable
                      className="symbol-tile__primary"
                      aria-pressed={mode === 'select' ? selected : undefined}
                      onClick={mode === 'select' ? () => onSelect?.(symbol.key) : undefined}
                      onDoubleClick={mode === 'insert' ? () => onInsert?.(symbol.key) : undefined}
                      onKeyDown={mode === 'insert' ? (event) => {
                        if (event.key === 'Enter') onInsert?.(symbol.key)
                      } : undefined}
                      title={mode === 'insert'
                        ? `拖动或双击插入${symbol.name}`
                        : `编辑${symbol.name}锚点`}
                    >
                      <img src={symbol.url} alt="" draggable={false} />
                      <span>{symbol.name}</span>
                    </Pressable>
                    {mode === 'insert' && onEdit ? (
                      <IconButton
                        className="symbol-tile__edit"
                        label={`编辑 ${symbol.name} 锚点`}
                        icon={<PencilLine />}
                        variant="neutral-soft"
                        onPointerDown={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                        }}
                        onClick={(event) => {
                          event.stopPropagation()
                          onEdit(symbol.key)
                        }}
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {Object.keys(filteredGroups).length === 0 ? (
          <div className="inline-empty">没有匹配的图元</div>
        ) : null}
      </div>
    </section>
  )
}
