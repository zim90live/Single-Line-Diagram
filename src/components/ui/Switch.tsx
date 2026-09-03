import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { classNames } from './classNames'

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'children' | 'type'> {
  label: ReactNode
  indicatorPosition?: 'start' | 'end'
  variant?: 'switch' | 'surface' | 'chip'
  indeterminate?: boolean
}

export function Switch({
  label,
  indicatorPosition = 'start',
  variant = 'switch',
  indeterminate = false,
  className,
  id,
  disabled,
  checked,
  title,
  ...inputProps
}: SwitchProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <label
      className={classNames('aidc-switch', className)}
      data-checked={checked || undefined}
      data-indeterminate={indeterminate || undefined}
      data-disabled={disabled || undefined}
      data-indicator-position={indicatorPosition}
      data-variant={variant}
      htmlFor={inputId}
      title={title}
    >
      <input
        {...inputProps}
        ref={inputRef}
        className="aidc-switch__input"
        id={inputId}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-checked={indeterminate ? 'mixed' : checked}
      />
      <span className="aidc-switch__indicator" aria-hidden="true" />
      <span className="aidc-switch__label">{label}</span>
    </label>
  )
}
