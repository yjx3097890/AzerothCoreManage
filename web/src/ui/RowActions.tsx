import type { ReactNode } from 'react'
import { useMemo, useRef, useState, useEffect } from 'react'
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

export function RowActions({ primary, primaryHint, items, moreLabel, moreHint }: Props) {
  const { t } = useTranslation()
  const menuItems = useMemo(() => buildMenu(items), [items])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  if (!primary && items.length === 0) return null

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
        <div ref={ref} className={`dropdown dropdown-end ${open ? 'dropdown-open' : ''}`}>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            title={typeof moreHint === 'string' ? moreHint : undefined}
            onClick={() => setOpen((v) => !v)}
          >
            {moreLabel ?? t('common.more')}
          </button>
          {open && (
            <ul className="dropdown-content menu bg-base-100 rounded-box z-50 w-52 p-2 shadow border border-base-300">
              {menuItems.map((entry) => {
                if (entry.type === 'divider') {
                  return <li key={entry.key} className="menu-title border-t border-base-300 my-1" />
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
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
