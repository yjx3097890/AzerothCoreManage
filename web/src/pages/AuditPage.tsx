import { useEffect, useState, type ReactNode } from 'react'
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

function summarizeAuditError(err: string, failLabel: string, soapUsageLabel: string): string {
  const s = err.replace(/\s+/g, ' ').trim()
  if (!s) return failLabel
  if (/USAGE/i.test(s) && /soap fault|playerbots|playerbot/i.test(s)) {
    return `${failLabel} · ${soapUsageLabel}`
  }
  if (/soap fault/i.test(s)) {
    const body = s.replace(/^.*?soap fault:\s*/i, '')
    const short = body.slice(0, 28)
    return `${failLabel} · ${short}${body.length > 28 ? '…' : ''}`
  }
  const short = s.slice(0, 32)
  return `${failLabel} · ${short}${s.length > 32 ? '…' : ''}`
}

function HoverCell({ full, children, className }: { full?: string; children: ReactNode; className?: string }) {
  // Native title keeps long SOAP/USAGE text readable; DaisyUI data-tip truncates badly.
  return (
    <span className={`cursor-help ${className ?? ''}`} title={full || undefined}>
      {children}
    </span>
  )
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
    { key: 'at', title: t('audit.at'), dataIndex: 'at', width: 170 },
    { key: 'username', title: t('audit.user'), dataIndex: 'username', width: 100 },
    { key: 'action', title: t('audit.action'), dataIndex: 'action', width: 140 },
    {
      key: 'detail',
      title: t('audit.detail'),
      render: (_v, row) => {
        const full = row.detail?.trim() || ''
        const oneLine = full.replace(/\s+/g, ' ')
        const shown = oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine || '—'
        return (
          <HoverCell full={full || undefined} className="block max-w-[14rem]">
            <span className="block truncate">{shown}</span>
          </HoverCell>
        )
      },
    },
    {
      key: 'result',
      title: t('audit.result'),
      width: 180,
      render: (_v, row) => {
        if (row.ok) {
          return <span className="badge badge-success badge-sm">{t('common.success')}</span>
        }
        const full = (row.error || '').trim()
        return (
          <HoverCell full={full || undefined}>
            <span className="badge badge-error badge-sm max-w-[11rem] truncate align-middle">
              {summarizeAuditError(full, t('common.fail'), t('audit.errSoapUsage'))}
            </span>
          </HoverCell>
        )
      },
    },
  ]

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">{t('pages.audit.title')}</h2>
      <DataTable rowKey="id" size="sm" dataSource={items} columns={columns} />
    </div>
  )
}
