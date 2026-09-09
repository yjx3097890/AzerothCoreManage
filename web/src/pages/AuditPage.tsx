import { Table, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '../api/client'
import { message } from 'antd'

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
      .catch((err) => message.error(errorMessage(err, t)))
  }, [t])

  return (
    <div>
      <Typography.Title level={3}>{t('pages.audit.title')}</Typography.Title>
      <Table
        rowKey="id"
        size="small"
        dataSource={items}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 70 },
          { title: t('audit.at'), dataIndex: 'at' },
          { title: t('audit.user'), dataIndex: 'username' },
          { title: t('audit.action'), dataIndex: 'action' },
          { title: t('audit.detail'), dataIndex: 'detail', ellipsis: true },
          {
            title: t('audit.result'),
            render: (_, row) =>
              row.ok ? (
                <Tag color="success">{t('common.success')}</Tag>
              ) : (
                <Tag color="error">{row.error || t('common.fail')}</Tag>
              ),
          },
        ]}
      />
    </div>
  )
}
