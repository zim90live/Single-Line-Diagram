import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { classNames } from './classNames'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  containerClassName?: string
  hideLabel?: boolean
}

export function TextField({
  label,
  hint,
  error,
  containerClassName,
  className,
  id,
  required,
  disabled,
  hideLabel = false,
  type = 'text',
  ...inputProps
}: TextFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const messageId = error || hint ? `${inputId}-message` : undefined
  return (
    <label
      className={classNames('aidc-field', 'aidc-text-field', containerClassName)}
      data-invalid={Boolean(error) || undefined}
      data-disabled={disabled || undefined}
      htmlFor={inputId}
    >
      <span className={classNames('aidc-field__label', hideLabel && 'visually-hidden')}>
        {label}{required ? <span aria-hidden="true"> *</span> : null}
      </span>
      <input
        {...inputProps}
        className={classNames('aidc-field__control', className)}
        id={inputId}
        type={type}
        required={required}
        disabled={disabled}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={messageId}
      />
      {error || hint ? (
        <span className="aidc-field__message" id={messageId}>{error ?? hint}</span>
      ) : null}
    </label>
  )
}
