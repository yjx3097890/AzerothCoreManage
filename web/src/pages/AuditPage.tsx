import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '../api/client'
import { DataTable, toast, type Column } from '../ui'

type AuditItem = {
  id: number
  at: string
  username: string
  role: string
  target_id: string
  action: string
  detail: string
  ok: boolean
  error?: string
}

export function AuditPage() {
  const { t } = useTranslation()
  const [items, setItems] = useState<AuditItem[]>([])

  useEffect(() => {
    api<{ items: AuditItem[] }>('/api/v1/audit')
      .then((data) => setItems(data.items || []))
      .catch((err) => toast.error(errorMessage(err, t)))
  }, [t])

  const columns: Column<AuditItem>[] = [
    { key: 'id', title: 'ID', dataIndex: 'id', width: 70 },
    { key: 'at', title: t('audit.at'), dataIndex: 'at' },
    { key: 'username', title: t('audit.user'), dataIndex: 'username' },
    { key: 'action', title: t('audit.action'), dataIndex: 'action' },
    {
      key: 'detail',
      title: t('audit.detail'),
      dataIndex: 'detail',
      className: 'max-w-xs truncate',
    },
    {
      key: 'result',
      title: t('audit.result'),
      render: (_, row) =>
        row.ok ? (
          <span className="badge badge-success">{t('common.success')}</span>
        ) : (
          <span className="badge badge-error">{row.error || t('common.fail')}</span>
        ),
    },
  ]

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">{t('pages.audit.title')}</h2>
      <DataTable rowKey="id" size="sm" dataSource={items} columns={columns} />
    </div>
  )
}
