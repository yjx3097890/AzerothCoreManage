import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
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
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open) {
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`modal ${open ? 'modal-open' : ''}`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      <div className={`modal-box ${className ?? ''}`}>
        {title != null && <h3 className="font-bold text-lg mb-3">{title}</h3>}
        <div className="py-1">{children}</div>
        {footer === null ? null : footer !== undefined ? (
          footer
        ) : (
          <div className="modal-action">
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
    </dialog>
  )
}
