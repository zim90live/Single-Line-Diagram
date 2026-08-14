import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'

export type ButtonVariant = 'neutral-soft' | 'neutral-ghost' | 'primary-solid' | 'danger-soft'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  loading?: boolean
  leadingIcon?: ReactNode
}

export function Button({
  variant = 'neutral-soft',
  loading = false,
  leadingIcon,
  className,
  children,
  disabled,
  type = 'button',
  ...buttonProps
}: ButtonProps) {
  return (
    <button
      {...buttonProps}
      className={classNames('aidc-button', className)}
      data-variant={variant}
      data-loading={loading || undefined}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {leadingIcon ? <span className="aidc-button__icon" aria-hidden="true">{leadingIcon}</span> : null}
      {children}
    </button>
  )
}
