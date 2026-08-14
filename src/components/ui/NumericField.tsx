import { useEffect, useId, useRef, useState } from 'react'
import { classNames } from './classNames'

export interface NumericFieldProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  unit?: string
  disabled?: boolean
  containerClassName?: string
  onCommit: (value: number) => void
}

function formatValue(value: number) {
  return String(Number(value.toFixed(2)))
}

export function NumericField({
  label,
  value,
  min = -100000,
  max = 100000,
  step = 1,
  unit,
  disabled,
  containerClassName,
  onCommit,
}: NumericFieldProps) {
  const inputId = useId()
  const [draft, setDraft] = useState(() => formatValue(value))
  const [invalid, setInvalid] = useState(false)
  const editingRef = useRef(false)

  useEffect(() => {
    if (!editingRef.current) setDraft(formatValue(value))
  }, [value])

  const commit = () => {
    editingRef.current = false
    const parsed = Number(draft)
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      setDraft(formatValue(value))
      setInvalid(false)
      return
    }
    setInvalid(false)
    setDraft(formatValue(parsed))
    if (parsed !== value) onCommit(parsed)
  }

  return (
    <label
      className={classNames('aidc-field', 'aidc-numeric-field', containerClassName)}
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      htmlFor={inputId}
    >
      <span className="aidc-field__label">{label}</span>
      <span className="aidc-field__numeric-control">
        <input
          id={inputId}
          className="aidc-field__control"
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onFocus={() => { editingRef.current = true }}
          onChange={(event) => {
            setDraft(event.target.value)
            const parsed = Number(event.target.value)
            setInvalid(event.target.value.trim() === '' || !Number.isFinite(parsed) || parsed < min || parsed > max)
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setDraft(formatValue(value))
              setInvalid(false)
              event.currentTarget.blur()
            } else if (event.key === 'Enter') {
              event.currentTarget.blur()
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              const base = Number.isFinite(Number(draft)) ? Number(draft) : value
              const next = Math.min(max, Math.max(min, base + (event.key === 'ArrowUp' ? step : -step)))
              setDraft(formatValue(next))
              setInvalid(false)
            }
          }}
        />
        {unit ? <span className="aidc-field__unit" aria-hidden="true">{unit}</span> : null}
      </span>
    </label>
  )
}
