import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { classNames } from './classNames'

interface FieldChromeProps {
  label: ReactNode
  inputId: string
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  disabled?: boolean
  hideLabel?: boolean
  className?: string
  children: ReactNode
}

function FieldChrome({
  label,
  inputId,
  hint,
  error,
  required,
  disabled,
  hideLabel = false,
  className,
  children,
}: FieldChromeProps) {
  const message = error ?? hint
  const messageId = message ? `${inputId}-message` : undefined

  return (
    <label
      className={classNames('aidc-field', className)}
      data-invalid={Boolean(error) || undefined}
      data-disabled={disabled || undefined}
      htmlFor={inputId}
    >
      <span className={classNames('aidc-field__label', hideLabel && 'visually-hidden')}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </span>
      {children}
      {message ? <span className="aidc-field__message" id={messageId}>{message}</span> : null}
    </label>
  )
}

export type TextFieldType = 'text' | 'search' | 'email' | 'password' | 'tel' | 'url'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  containerClassName?: string
  hideLabel?: boolean
  type?: TextFieldType
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
    <FieldChrome
      className={classNames('aidc-text-field', containerClassName)}
      label={label}
      inputId={inputId}
      hint={hint}
      error={error}
      required={required}
      disabled={disabled}
      hideLabel={hideLabel}
    >
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
    </FieldChrome>
  )
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
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
    <FieldChrome
      className={classNames('aidc-select-field', containerClassName)}
      label={label}
      inputId={selectId}
      hint={hint}
      error={error}
      required={required}
      disabled={disabled}
      hideLabel={hideLabel}
    >
      <span className="aidc-field__select-control">
        <select
          {...selectProps}
          className={classNames('aidc-field__control', 'aidc-field__select', className)}
          id={selectId}
          required={required}
          disabled={disabled}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={messageId}
        >
          {children}
        </select>
        <svg aria-hidden="true" className="aidc-field__select-caret" focusable="false" viewBox="0 0 10 10">
          <path d="m2 3.5 3 3 3-3" />
        </svg>
      </span>
    </FieldChrome>
  )
}
