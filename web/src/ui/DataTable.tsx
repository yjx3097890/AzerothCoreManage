import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type Column<T> = {
  key: string
  title: ReactNode
  dataIndex?: keyof T | string
  render?: (value: unknown, record: T, index: number) => ReactNode
  width?: number | string
  className?: string
}

type Props<T> = {
  columns: Column<T>[]
  dataSource: T[]
  rowKey: keyof T | ((record: T) => string | number)
  loading?: boolean
  pagination?: false | { pageSize?: number }
  size?: 'sm' | 'md'
  emptyText?: ReactNode
}

function getByPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined
  if (!path.includes('.')) return (obj as Record<string, unknown>)[path]
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[key]
  }, obj)
}

export function DataTable<T>({
  columns,
  dataSource,
  rowKey,
  loading,
  pagination = { pageSize: 20 },
  size = 'sm',
  emptyText,
}: Props<T>) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const pageSize = pagination === false ? dataSource.length || 1 : (pagination.pageSize ?? 20)

  const total = dataSource.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1)
  const current = Math.min(page, totalPages)

  const pageRows = useMemo(() => {
    if (pagination === false) return dataSource
    const start = (current - 1) * pageSize
    return dataSource.slice(start, start + pageSize)
  }, [dataSource, current, pageSize, pagination])

  const resolveKey = (record: T, index: number) => {
    if (typeof rowKey === 'function') return String(rowKey(record))
    const v = record[rowKey]
    return v == null ? String(index) : String(v)
  }

  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-base-100/60">
          <span className="loading loading-spinner loading-md" />
        </div>
      )}
      <div className="overflow-x-auto rounded-box border border-base-300">
        <table className={`table table-zebra ${size === 'sm' ? 'table-sm' : ''} w-full`}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={col.width ? { width: col.width } : undefined} className={col.className}>
                  {col.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center text-base-content/60 py-8">
                  {emptyText ?? t('common.empty', { defaultValue: '—' })}
                </td>
              </tr>
            ) : (
              pageRows.map((record, index) => (
                <tr key={resolveKey(record, index)} className="hover">
                  {columns.map((col) => {
                    const raw =
                      col.dataIndex != null ? getByPath(record, String(col.dataIndex)) : undefined
                    const content = col.render
                      ? col.render(raw, record, (current - 1) * pageSize + index)
                      : (raw as ReactNode)
                    return (
                      <td key={col.key} className={col.className}>
                        {content}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pagination !== false && total > pageSize && (
        <div className="flex items-center justify-end gap-2 mt-3">
          <span className="text-sm text-base-content/60">
            {total} · {current}/{totalPages}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={current <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ‹
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={current >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            ›
          </button>
        </div>
      )}
    </div>
  )
}
