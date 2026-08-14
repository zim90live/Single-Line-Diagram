import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'

export interface PressableProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
}

export function Pressable({ className, children, type = 'button', ...buttonProps }: PressableProps) {
  return <button {...buttonProps} className={classNames('aidc-pressable', className)} type={type}>{children}</button>
}
