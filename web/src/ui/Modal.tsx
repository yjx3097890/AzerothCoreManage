import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

type Props = {
  open: boolean
  title?: ReactNode
  children?: ReactNode
  onClose: () => void
  onOk?: () => void | Promise<void>
  okText?: string
  cancelText?: string
  okDanger?: boolean
  confirmLoading?: boolean
  footer?: ReactNode | null
  className?: string
}

export function Modal({
  open,
  title,
  children,
  onClose,
  onOk,
  okText,
  cancelText,
  okDanger,
  confirmLoading,
  footer,
  className,
}: Props) {
  const { t } = useTranslation()
  // Ignore the same click that opened the modal (avoids instant close).
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
      if (e.key === 'Escape' && !confirmLoading) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.clearTimeout(armTimer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, confirmLoading])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 border-0 cursor-default"
        aria-label="close"
        tabIndex={-1}
        disabled={confirmLoading}
        onClick={() => {
          if (armed && !confirmLoading) onClose()
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative z-10 bg-base-100 text-base-content rounded-box shadow-2xl border border-base-300 w-full max-w-lg max-h-[min(90vh,720px)] overflow-y-auto p-6 ${className ?? ''}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title != null && <h3 className="font-bold text-lg mb-3">{title}</h3>}
        <div className="py-1">{children}</div>
        {footer === null ? null : footer !== undefined ? (
          footer
        ) : (
          <div className="flex justify-end gap-2 mt-6">
            <button type="button" className="btn" onClick={onClose} disabled={confirmLoading}>
              {cancelText ?? t('confirm.cancel')}
            </button>
            {onOk && (
              <button
                type="button"
                className={`btn ${okDanger ? 'btn-error' : 'btn-primary'}`}
                disabled={confirmLoading}
                onClick={() => void onOk()}
              >
                {confirmLoading && <span className="loading loading-spinner loading-sm" />}
                {okText ?? t('confirm.ok')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
