import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from './Modal'

type Props = {
  open: boolean
  title?: string
  description?: ReactNode
  confirmText?: string
  danger?: boolean
  loading?: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

/** P0-38: 危险操作二次确认 */
export function ConfirmDanger({
  open,
  title,
  description,
  confirmText,
  danger = true,
  loading,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation()
  return (
    <Modal
      open={open}
      title={title ?? t('confirm.title')}
      okText={confirmText ?? t('confirm.ok')}
      okDanger={danger}
      confirmLoading={loading}
      onClose={onCancel}
      onOk={() => void onConfirm()}
    >
      {description ?? t('confirm.hint')}
    </Modal>
  )
}
