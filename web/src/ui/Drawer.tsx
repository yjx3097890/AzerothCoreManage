import type { ReactNode } from 'react'

type Props = {
  open: boolean
  title?: ReactNode
  children?: ReactNode
  onClose: () => void
  width?: number | string
  extra?: ReactNode
}

export function Drawer({ open, title, children, onClose, width = 420, extra }: Props) {
  const w = typeof width === 'number' ? `${width}px` : width

  return (
    <div className={`drawer drawer-end ${open ? 'drawer-open' : ''}`}>
      <input type="checkbox" className="drawer-toggle" checked={open} readOnly />
      <div className="drawer-side z-40">
        <button type="button" className="drawer-overlay" aria-label="close" onClick={onClose} />
        <aside
          className="bg-base-100 text-base-content min-h-full flex flex-col shadow-xl"
          style={{ width: w, maxWidth: '100vw' }}
        >
          <div className="flex items-center gap-2 border-b border-base-300 px-4 py-3">
            <h3 className="font-semibold text-base flex-1 truncate">{title}</h3>
            {extra}
            <button type="button" className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="close">
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
        </aside>
      </div>
    </div>
  )
}
