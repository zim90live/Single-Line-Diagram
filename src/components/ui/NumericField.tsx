import { useEffect, useId, useRef, useState } from 'react'
import { classNames } from './classNames'

export interface NumericFieldProps {
  id?: string
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  unit?: string
  integer?: boolean
  disabled?: boolean
  tone?: 'x' | 'y' | 'z' | 'neutral'
  layout?: 'stacked' | 'inline'
  containerClassName?: string
  commitMode?: 'blur' | 'submit'
  onCommit?: (value: number) => void
  onDraftChange?: (draft: string, value: number | null) => void
  onEditStart?: () => void
  onValidChange?: (value: number) => boolean
  onEditCommit?: () => void
  onEditCancel?: () => void
}

function formatValue(value: number, integer: boolean) {
  return integer ? String(Math.round(value)) : String(Number(value.toFixed(2)))
}

function parseValidValue(draft: string, min: number, max: number, integer: boolean) {
  if (draft.trim() === '') return null
  const value = Number(draft)
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    return null
  }
  return value
}

export function NumericField({
  id,
  label,
  value,
  min = -100000,
  max = 100000,
  step = 1,
  unit = '',
  integer = false,
  disabled = false,
  tone = 'neutral',
  layout = 'stacked',
  containerClassName,
  commitMode = 'blur',
  onCommit,
  onDraftChange,
  onEditStart,
  onValidChange,
  onEditCommit,
  onEditCancel,
}: NumericFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const [draft, setDraft] = useState(() => formatValue(value, integer))
  const [isFocused, setIsFocused] = useState(false)
  const [isInvalid, setIsInvalid] = useState(false)
  const cancelOnBlurRef = useRef(false)
  const externalValueRef = useRef(formatValue(value, integer))

  useEffect(() => {
    const formattedValue = formatValue(value, integer)
    const externalValueChanged = externalValueRef.current !== formattedValue
    externalValueRef.current = formattedValue
    if (!isFocused && (commitMode === 'blur' || externalValueChanged)) {
      setDraft(formattedValue)
      setIsInvalid(false)
    }
  }, [commitMode, integer, isFocused, value])

  const resetDraft = () => {
    const formattedValue = formatValue(value, integer)
    setDraft(formattedValue)
    setIsInvalid(false)
    onDraftChange?.(formattedValue, value)
  }

  const handleChange = (nextDraft: string) => {
    setDraft(nextDraft)
    const nextValue = parseValidValue(nextDraft, min, max, integer)
    if (nextValue === null) {
      setIsInvalid(true)
      onDraftChange?.(nextDraft, null)
      return
    }
    const accepted = onValidChange?.(nextValue) ?? true
    setIsInvalid(!accepted)
    onDraftChange?.(nextDraft, accepted ? nextValue : null)
  }

  const handleBlur = () => {
    setIsFocused(false)
    if (cancelOnBlurRef.current) {
      cancelOnBlurRef.current = false
      resetDraft()
      return
    }
    if (commitMode === 'submit') return

    const nextValue = parseValidValue(draft, min, max, integer)
    if (nextValue === null || isInvalid) {
      onEditCancel?.()
      resetDraft()
      return
    }
    if (nextValue !== value) onCommit?.(nextValue)
    onEditCommit?.()
    setDraft(formatValue(nextValue, integer))
  }

  return (
    <label
      className={classNames('aidc-field', 'aidc-numeric-field', containerClassName)}
      data-disabled={disabled || undefined}
      data-invalid={isInvalid || undefined}
      data-tone={tone}
      data-layout={layout}
      htmlFor={inputId}
    >
      <span className="aidc-field__label">{label}</span>
      <span className="aidc-field__numeric-control">
        <input
          className="aidc-field__control"
          id={inputId}
          type="text"
          inputMode={integer ? 'numeric' : 'decimal'}
          value={draft}
          disabled={disabled}
          aria-invalid={isInvalid || undefined}
          onBlur={handleBlur}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={() => {
            setIsFocused(true)
            onEditStart?.()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              cancelOnBlurRef.current = true
              onEditCancel?.()
              resetDraft()
              event.currentTarget.blur()
              return
            }
            if (event.key === 'Enter') {
              event.currentTarget.blur()
              return
            }
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              const parsedValue = parseValidValue(draft, min, max, integer)
              const baseValue = parsedValue ?? value
              const direction = event.key === 'ArrowUp' ? 1 : -1
              const nextValue = Math.min(max, Math.max(min, Number((baseValue + direction * step).toFixed(8))))
              handleChange(formatValue(nextValue, integer))
            }
          }}
        />
        {unit ? <span className="aidc-field__unit" aria-hidden="true">{unit}</span> : null}
        {isInvalid ? <span className="aidc-numeric-field__error" aria-hidden="true">!</span> : null}
      </span>
    </label>
  )
}
