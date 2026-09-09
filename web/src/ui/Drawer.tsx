import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

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
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!open) {
      setArmed(false)
      return
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const armTimer = window.setTimeout(() => setArmed(true), 50)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.clearTimeout(armTimer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[120] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 border-0 cursor-default"
        aria-label="close"
        tabIndex={-1}
        onClick={() => {
          if (armed) onClose()
        }}
      />
      <aside
        className="relative h-full bg-base-100 text-base-content shadow-2xl flex flex-col border-l border-base-300"
        style={{ width: w, maxWidth: '100vw' }}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-base-300 px-4 py-3 shrink-0">
          <h3 className="font-semibold text-base flex-1 truncate">{title}</h3>
          {extra}
          <button type="button" className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>,
    document.body,
  )
}
