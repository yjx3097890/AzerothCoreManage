import { Button, Dropdown, Space, Tooltip, type MenuProps } from 'antd'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export type RowActionItem = {
  key: string
  label: ReactNode
  /** Hover hint shown on the menu item. */
  hint?: ReactNode
  danger?: boolean
  disabled?: boolean
  /** Same group key shares one group header; order follows first appearance. */
  group?: string
  onClick: () => void
}

type Props = {
  primary?: ReactNode
  /** Hover hint for the primary control (wraps primary in Tooltip when set). */
  primaryHint?: ReactNode
  items: RowActionItem[]
  moreLabel?: string
  moreHint?: ReactNode
}

export function RowActions({ primary, primaryHint, items, moreLabel, moreHint }: Props) {
  const { t } = useTranslation()
  const menuItems = useMemo(() => buildMenuItems(items), [items])

  if (!primary && items.length === 0) {
    return null
  }

  const moreBtn = (
    <Button size="small">{moreLabel ?? t('common.more')}</Button>
  )

  return (
    <Space size={4} wrap={false}>
      {primaryHint ? <Tooltip title={primaryHint}>{primary}</Tooltip> : primary}
      {menuItems.length > 0 && (
        <Dropdown menu={{ items: menuItems }} trigger={['click']}>
          {moreHint ? <Tooltip title={moreHint}>{moreBtn}</Tooltip> : moreBtn}
        </Dropdown>
      )}
    </Space>
  )
}

function buildMenuItems(items: RowActionItem[]): MenuProps['items'] {
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

  const out: NonNullable<MenuProps['items']> = []

  for (const g of order) {
    const list = buckets.get(g) ?? []
    if (list.length === 0) continue
    out.push({ type: 'group', label: g, key: `group-${g}`, children: list.map(toMenuItem) })
  }

  if (ungrouped.length > 0) {
    if (out.length > 0) {
      out.push({ type: 'divider' })
    }
    for (const item of ungrouped) {
      out.push(toMenuItem(item))
    }
  }

  return out
}

function toMenuItem(item: RowActionItem): NonNullable<MenuProps['items']>[number] {
  const label = item.hint ? (
    <Tooltip placement="left" title={item.hint}>
      <span>{item.label}</span>
    </Tooltip>
  ) : (
    item.label
  )
  return {
    key: item.key,
    label,
    danger: item.danger,
    disabled: item.disabled,
    title: typeof item.hint === 'string' ? item.hint : undefined,
    onClick: () => item.onClick(),
  }
}
