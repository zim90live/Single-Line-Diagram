import type { HTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'

export type StatusTagTone = 'neutral' | 'success' | 'warning' | 'danger' | 'cooling' | 'electrical'

export interface StatusTagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTagTone
  dot?: boolean
  children: ReactNode
}

export function StatusTag({ tone = 'neutral', dot = false, className, children, ...tagProps }: StatusTagProps) {
  return (
    <span {...tagProps} className={classNames('aidc-status-tag', className)} data-tone={tone}>
      {dot ? <span className="aidc-status-tag__dot" aria-hidden="true" /> : null}
      <span className="aidc-status-tag__label">{children}</span>
    </span>
  )
}
