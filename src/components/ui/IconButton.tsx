import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'

export type IconButtonVariant = 'neutral-soft' | 'neutral-ghost' | 'primary-solid' | 'danger-soft'

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  label: string
  icon: ReactNode
  variant?: IconButtonVariant
}

export function IconButton({
  label,
  icon,
  variant = 'neutral-soft',
  className,
  type = 'button',
  ...buttonProps
}: IconButtonProps) {
  return (
    <button
      {...buttonProps}
      aria-label={label}
      title={buttonProps.title ?? label}
      className={classNames('aidc-icon-button', className)}
      data-variant={variant}
      type={type}
    >
      <span className="aidc-icon-button__icon" aria-hidden="true">{icon}</span>
    </button>
  )
}
