import type { ReactNode } from 'react'
import { useState } from 'react'

export type TabItem = {
  key: string
  label: ReactNode
  children: ReactNode
}

type Props = {
  items: TabItem[]
  activeKey?: string
  defaultActiveKey?: string
  onChange?: (key: string) => void
  className?: string
}

export function Tabs({ items, activeKey, defaultActiveKey, onChange, className }: Props) {
  const [inner, setInner] = useState(defaultActiveKey ?? items[0]?.key ?? '')
  const current = activeKey ?? inner
  const active = items.find((i) => i.key === current) ?? items[0]

  return (
    <div className={className}>
      <div role="tablist" className="tabs tabs-bordered mb-2 flex-wrap gap-y-1">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            className={`tab ${item.key === active?.key ? 'tab-active' : ''}`}
            onClick={() => {
              if (activeKey == null) setInner(item.key)
              onChange?.(item.key)
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div>{active?.children}</div>
    </div>
  )
}
