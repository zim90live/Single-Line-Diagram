import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, KeyboardEvent, ReactNode } from 'react'
import { classNames } from './classNames'

export type TabListLayout = 'inline' | 'equal' | 'grid' | 'scroll'

export interface TabListProps extends HTMLAttributes<HTMLDivElement> {
  label: string
  layout?: TabListLayout
  columns?: number
}

function moveTabFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'))
  if (tabs.length === 0) return
  const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement)
  let nextIndex = currentIndex
  if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = tabs.length - 1
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
  else nextIndex = (currentIndex + 1) % tabs.length
  event.preventDefault()
  tabs[nextIndex]?.focus()
  tabs[nextIndex]?.click()
}

export function TabList({
  label,
  className,
  children,
  layout = 'inline',
  columns,
  style,
  onKeyDown,
  ...tabListProps
}: TabListProps) {
  const tabListStyle = {
    ...style,
    ...(columns ? { '--aidc-tab-columns': String(columns) } : null),
  } as CSSProperties

  return (
    <div
      {...tabListProps}
      className={classNames('aidc-tab-list', className)}
      data-layout={layout}
      style={tabListStyle}
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!event.defaultPrevented) moveTabFocus(event)
      }}
    >
      {children}
    </div>
  )
}

export interface TabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'role'> {
  selected: boolean
  count?: ReactNode
}

export function Tab({ selected, count, className, children, type = 'button', ...tabProps }: TabProps) {
  return (
    <button
      {...tabProps}
      className={classNames('aidc-tab', className)}
      type={type}
      role="tab"
      aria-selected={selected}
      data-selected={selected || undefined}
      tabIndex={selected ? 0 : -1}
    >
      <span>{children}</span>
      {count !== undefined ? <span className="aidc-tab__count">{count}</span> : null}
    </button>
  )
}
