import type { ReactNode } from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
  valueLabel?: ReactNode
}

type Pos = { top: number; left: number; width: number; openUp: boolean }

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
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<Pos | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.value === value)
  const display =
    selected?.label ??
    valueLabel ??
    (value != null && value !== '' ? String(value) : '')

  const filtered = (() => {
    const qq = q.trim().toLowerCase()
    if (!qq) return options
    return options.filter((o) => {
      const fromSearch = o.searchText?.toLowerCase()
      if (fromSearch) return fromSearch.includes(qq)
      if (typeof o.label === 'string') return o.label.toLowerCase().includes(qq)
      return String(o.value).toLowerCase().includes(qq)
    })
  })()

  const place = () => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const panelH = panelRef.current?.offsetHeight ?? 280
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < panelH + 8 && rect.top > spaceBelow
    const width = Math.max(rect.width, 260)
    let left = rect.left
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    setPos({
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      left,
      width,
      openUp,
    })
  }

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    place()
    requestAnimationFrame(() => {
      place()
      inputRef.current?.focus()
    })
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setQ('')
      return
    }
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className={`input input-bordered w-full flex items-center gap-2 text-left font-normal h-auto min-h-10 ${disabled ? 'input-disabled' : ''}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => {
          if (!disabled) setOpen((v) => !v)
        }}
      >
        <span className={`flex-1 truncate ${display ? '' : 'text-base-content/40'}`}>
          {display || placeholder || '—'}
        </span>
        {loading && <span className="loading loading-spinner loading-xs" />}
        {allowClear && value != null && value !== '' && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            className="btn btn-ghost btn-xs btn-circle"
            onClick={(e) => {
              e.stopPropagation()
              onChange?.(undefined)
            }}
          >
            ✕
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[220] bg-base-100 border border-base-300 rounded-box shadow-lg p-2"
            style={
              pos
                ? {
                    top: pos.openUp ? undefined : pos.top,
                    bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
                    left: pos.left,
                    width: pos.width,
                    visibility: 'visible',
                  }
                : { top: 0, left: 0, visibility: 'hidden' }
            }
          >
            <input
              ref={inputRef}
              className="input input-bordered input-sm w-full mb-2"
              placeholder={placeholder}
              value={q}
              onChange={(e) => {
                const next = e.target.value
                setQ(next)
                onSearch?.(next)
              }}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <ul id={listId} className="menu menu-sm max-h-60 overflow-y-auto w-full p-0" role="listbox">
              {filtered.length === 0 ? (
                <li className="disabled">
                  <span className="text-base-content/50">{loading ? '…' : '—'}</span>
                </li>
              ) : (
                filtered.map((o) => (
                  <li key={String(o.value)}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={o.value === value}
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
          </div>,
          document.body,
        )}
    </div>
  )
}
