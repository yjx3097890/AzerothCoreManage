import type { ReactNode } from 'react'
import { useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

export type RowActionItem = {
  key: string
  label: ReactNode
  hint?: ReactNode
  danger?: boolean
  disabled?: boolean
  group?: string
  onClick: () => void
}

type Props = {
  primary?: ReactNode
  primaryHint?: ReactNode
  items: RowActionItem[]
  moreLabel?: string
  moreHint?: ReactNode
}

type MenuEntry =
  | { type: 'group'; key: string; label: string; children: RowActionItem[] }
  | { type: 'divider'; key: string }
  | { type: 'item'; key: string; item: RowActionItem }

function buildMenu(items: RowActionItem[]): MenuEntry[] {
  if (items.length === 0) return []

  const order: string[] = []
  const buckets = new Map<string, RowActionItem[]>()
  const ungrouped: RowActionItem[] = []

  for (const item of items) {
    if (!item.group) {
      ungrouped.push(item)
      continue
    }
    if (!buckets.has(item.group)) {
      order.push(item.group)
      buckets.set(item.group, [])
    }
    buckets.get(item.group)!.push(item)
  }

  const out: MenuEntry[] = []
  for (const g of order) {
    const list = buckets.get(g) ?? []
    if (list.length === 0) continue
    out.push({ type: 'group', key: `group-${g}`, label: g, children: list })
  }
  if (ungrouped.length > 0) {
    if (out.length > 0) out.push({ type: 'divider', key: 'div' })
    for (const item of ungrouped) {
      out.push({ type: 'item', key: item.key, item })
    }
  }
  return out
}

type MenuPos = { top: number; left: number; openUp: boolean }

export function RowActions({ primary, primaryHint, items, moreLabel, moreHint }: Props) {
  const { t } = useTranslation()
  const menuItems = useMemo(() => buildMenu(items), [items])
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)

  const placeMenu = () => {
    const btn = btnRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const menuH = menuRef.current?.offsetHeight ?? 280
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < menuH + 8 && rect.top > spaceBelow
    const width = 208
    let left = rect.right - width
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    setPos({
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      left,
      openUp,
    })
  }

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    placeMenu()
    requestAnimationFrame(placeMenu)
    window.addEventListener('scroll', placeMenu, true)
    window.addEventListener('resize', placeMenu)
    return () => {
      window.removeEventListener('scroll', placeMenu, true)
      window.removeEventListener('resize', placeMenu)
    }
  }, [open, menuItems])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return
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

  if (!primary && items.length === 0) return null

  const menu =
    open &&
    createPortal(
      <ul
        ref={menuRef}
        className="menu menu-sm bg-base-100 rounded-box w-52 p-2 shadow-lg border border-base-300 fixed z-[200]"
        style={
          pos
            ? {
                top: pos.openUp ? undefined : pos.top,
                bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
                left: pos.left,
                visibility: 'visible',
              }
            : { top: 0, left: 0, visibility: 'hidden' }
        }
        role="menu"
      >
        {menuItems.map((entry) => {
          if (entry.type === 'divider') {
            return (
              <li key={entry.key} className="pointer-events-none px-2 py-1" aria-hidden>
                <div className="h-px w-full bg-base-content/25" />
              </li>
            )
          }
          if (entry.type === 'group') {
            return (
              <li key={entry.key}>
                <span className="menu-title">{entry.label}</span>
                <ul>
                  {entry.children.map((item) => (
                    <li key={item.key}>
                      <button
                        type="button"
                        disabled={item.disabled}
                        className={item.danger ? 'text-error' : ''}
                        title={typeof item.hint === 'string' ? item.hint : undefined}
                        onClick={() => {
                          setOpen(false)
                          item.onClick()
                        }}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            )
          }
          const item = entry.item
          return (
            <li key={entry.key}>
              <button
                type="button"
                disabled={item.disabled}
                className={item.danger ? 'text-error' : ''}
                title={typeof item.hint === 'string' ? item.hint : undefined}
                onClick={() => {
                  setOpen(false)
                  item.onClick()
                }}
              >
                {item.label}
              </button>
            </li>
          )
        })}
      </ul>,
      document.body,
    )

  return (
    <div className="flex items-center gap-1 flex-nowrap">
      {primaryHint ? (
        <span className="tooltip tooltip-left" data-tip={typeof primaryHint === 'string' ? primaryHint : undefined}>
          {primary}
        </span>
      ) : (
        primary
      )}
      {menuItems.length > 0 && (
        <>
          <button
            ref={btnRef}
            type="button"
            className="btn btn-ghost btn-xs"
            title={typeof moreHint === 'string' ? moreHint : undefined}
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => setOpen((v) => !v)}
          >
            {moreLabel ?? t('common.more')}
          </button>
          {menu}
        </>
      )}
    </div>
  )
}
