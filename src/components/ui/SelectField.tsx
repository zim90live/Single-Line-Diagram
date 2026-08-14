import { useId, type ReactNode, type SelectHTMLAttributes } from 'react'

import { classNames } from './classNames'

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  containerClassName?: string
  hideLabel?: boolean
}

export function SelectField({
  label,
  hint,
  error,
  containerClassName,
  className,
  id,
  required,
  disabled,
  hideLabel = false,
  children,
  ...selectProps
}: SelectFieldProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const messageId = error || hint ? `${selectId}-message` : undefined

  return (
    <label
      className={classNames('aidc-field', 'aidc-select-field', containerClassName)}
      data-invalid={Boolean(error) || undefined}
      data-disabled={disabled || undefined}
      htmlFor={selectId}
    >
      <span className={classNames('aidc-field__label', hideLabel && 'visually-hidden')}>
        {label}{required ? <span aria-hidden="true"> *</span> : null}
      </span>
      <select
        {...selectProps}
        className={classNames('aidc-field__control', className)}
        id={selectId}
        required={required}
        disabled={disabled}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={messageId}
      >
        {children}
      </select>
      {error || hint ? (
        <span className="aidc-field__message" id={messageId}>{error ?? hint}</span>
      ) : null}
    </label>
  )
}
