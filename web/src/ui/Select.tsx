import type { ReactNode } from 'react'

export type SelectOption<T extends string | number = string | number> = {
  value: T
  label: ReactNode
  disabled?: boolean
}

type Props<T extends string | number> = {
  value?: T | null
  onChange?: (value: T | undefined) => void
  options: SelectOption<T>[]
  placeholder?: string
  allowClear?: boolean
  disabled?: boolean
  className?: string
  id?: string
}

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  placeholder,
  allowClear,
  disabled,
  className,
  id,
}: Props<T>) {
  const strVal = value == null || value === '' ? '' : String(value)

  return (
    <select
      id={id}
      className={`select select-bordered w-full ${className ?? ''}`}
      disabled={disabled}
      value={strVal}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === '') {
          onChange?.(undefined)
          return
        }
        const opt = options.find((o) => String(o.value) === raw)
        if (opt) onChange?.(opt.value)
      }}
    >
      {(allowClear || placeholder) && (
        <option value="">{placeholder ?? '—'}</option>
      )}
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
          {typeof o.label === 'string' || typeof o.label === 'number' ? o.label : String(o.value)}
        </option>
      ))}
    </select>
  )
}
