import type { HTMLAttributes } from 'react'
import { classNames } from './classNames'

export type SegmentedControlTone = 'neutral' | 'success' | 'warning' | 'danger'

export interface SegmentedControlOption<Value extends string> {
  value: Value
  label: string
  title?: string
  tone?: SegmentedControlTone
  disabled?: boolean
}

export interface SegmentedControlProps<Value extends string> extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: Value
  options: readonly SegmentedControlOption<Value>[]
  onValueChange: (value: Value) => void
  label: string
}

export function SegmentedControl<Value extends string>({
  value,
  options,
  onValueChange,
  label,
  className,
  ...groupProps
}: SegmentedControlProps<Value>) {
  return (
    <div {...groupProps} className={classNames('aidc-segmented-control', className)} role="group" aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            className="aidc-segmented-control__item"
            key={option.value}
            type="button"
            data-selected={selected || undefined}
            data-tone={option.tone}
            aria-pressed={selected}
            title={option.title}
            disabled={option.disabled}
            onClick={() => onValueChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
