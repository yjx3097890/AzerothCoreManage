import type { ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'

export type SearchOption<T extends string | number> = {
  value: T
  label: ReactNode
  searchText?: string
}

type Props<T extends string | number> = {
  value?: T | null
  onChange?: (value: T | undefined) => void
  options: SearchOption<T>[]
  loading?: boolean
  placeholder?: string
  allowClear?: boolean
  disabled?: boolean
  onSearch?: (q: string) => void
  className?: string
  /** When value is set but not in options, show this label */
  valueLabel?: ReactNode
}

export function SearchSelect<T extends string | number>({
  value,
  onChange,
  options,
  loading,
  placeholder,
  allowClear = true,
  disabled,
  onSearch,
  className,
  valueLabel,
}: Props<T>) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)
  const display =
    selected?.label ??
    valueLabel ??
    (value != null && value !== '' ? String(value) : '')

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    if (!open) setQ('')
  }, [open])

  return (
    <div ref={rootRef} className={`dropdown w-full ${open ? 'dropdown-open' : ''} ${className ?? ''}`}>
      <div
        tabIndex={0}
        role="combobox"
        aria-expanded={open}
        aria-controls={id}
        className={`input input-bordered w-full flex items-center gap-2 cursor-pointer ${disabled ? 'input-disabled' : ''}`}
        onClick={() => {
          if (!disabled) setOpen(true)
        }}
      >
        <span className={`flex-1 truncate text-left ${display ? '' : 'text-base-content/40'}`}>
          {display || placeholder || '—'}
        </span>
        {loading && <span className="loading loading-spinner loading-xs" />}
        {allowClear && value != null && value !== '' && !disabled && (
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-circle"
            onClick={(e) => {
              e.stopPropagation()
              onChange?.(undefined)
            }}
          >
            ✕
          </button>
        )}
      </div>
      {open && (
        <div className="dropdown-content z-50 bg-base-100 border border-base-300 rounded-box w-full mt-1 shadow-lg p-2">
          <input
            className="input input-bordered input-sm w-full mb-2"
            placeholder={placeholder}
            value={q}
            autoFocus
            onChange={(e) => {
              setQ(e.target.value)
              onSearch?.(e.target.value)
            }}
          />
          <ul id={id} className="menu menu-sm max-h-60 overflow-y-auto w-full p-0">
            {options.length === 0 ? (
              <li className="disabled">
                <span className="text-base-content/50">{loading ? '…' : '—'}</span>
              </li>
            ) : (
              options.map((o) => (
                <li key={String(o.value)}>
                  <button
                    type="button"
                    className={o.value === value ? 'active' : ''}
                    onClick={() => {
                      onChange?.(o.value)
                      setOpen(false)
                    }}
                  >
                    {o.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
