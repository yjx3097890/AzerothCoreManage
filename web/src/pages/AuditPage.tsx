import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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

/** Portal tooltip — survives DataTable overflow clipping. */
function HoverTip({ text, children }: { text: string; children: ReactNode }) {
  const tipId = useId()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, place: 'top' as 'top' | 'bottom' })

  const updatePos = () => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const place = r.top > 160 ? 'top' : 'bottom'
    const left = Math.min(Math.max(12, r.left + r.width / 2), window.innerWidth - 12)
    const top = place === 'top' ? r.top - 8 : r.bottom + 8
    setPos({ top, left, place })
  }

  useEffect(() => {
    if (!open) return
    updatePos()
    const onScroll = () => updatePos()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  return (
    <>
      <span
        ref={anchorRef}
        className="inline-flex max-w-full"
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={() => {
          updatePos()
          setOpen(true)
        }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => {
          updatePos()
          setOpen(true)
        }}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            id={tipId}
            role="tooltip"
            className="fixed z-[200] pointer-events-none max-w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-box border border-base-300 bg-neutral text-neutral-content shadow-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words"
            style={{
              top: pos.top,
              left: pos.left,
              transform: pos.place === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
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
        const cell = <span className="block truncate max-w-[14rem]">{shown}</span>
        if (full.length <= 48) return cell
        return <HoverTip text={full}>{cell}</HoverTip>
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
        const badge = (
          <span className="badge badge-error badge-sm max-w-[11rem] truncate align-middle">
            {summarizeAuditError(full, t('common.fail'), t('audit.errSoapUsage'))}
          </span>
        )
        if (!full) return badge
        return <HoverTip text={full}>{badge}</HoverTip>
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
