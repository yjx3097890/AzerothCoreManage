import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type Column<T> = {
  key: string
  title: ReactNode
  dataIndex?: keyof T | string
  render?: (value: unknown, record: T, index: number) => ReactNode
  width?: number | string
  className?: string
  /** true = compare by dataIndex/sortValue; or provide a comparator */
  sorter?: boolean | ((a: T, b: T) => number)
  /** Value used when sorter === true */
  sortValue?: (record: T) => string | number | null | undefined
}

type SortDir = 'asc' | 'desc'

type Props<T> = {
  columns: Column<T>[]
  dataSource: T[]
  rowKey: keyof T | ((record: T) => string | number)
  loading?: boolean
  pagination?: false | { pageSize?: number }
  size?: 'sm' | 'md'
  emptyText?: ReactNode
  defaultSortKey?: string
  defaultSortDir?: SortDir
}

function getByPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined
  if (!path.includes('.')) return (obj as Record<string, unknown>)[path]
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[key]
  }, obj)
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null || a === '') return 1
  if (b == null || b === '') return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const as = String(a)
  const bs = String(b)
  const an = Date.parse(as)
  const bn = Date.parse(bs)
  if (!Number.isNaN(an) && !Number.isNaN(bn) && /[-T:]/.test(as) && /[-T:]/.test(bs)) {
    return an - bn
  }
  const na = Number(as)
  const nb = Number(bs)
  if (as.trim() !== '' && bs.trim() !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) {
    return na - nb
  }
  return as.localeCompare(bs, undefined, { numeric: true, sensitivity: 'base' })
}

function resolveSortValue<T>(col: Column<T>, record: T): unknown {
  if (col.sortValue) return col.sortValue(record)
  if (col.dataIndex != null) return getByPath(record, String(col.dataIndex))
  return undefined
}

export function DataTable<T>({
  columns,
  dataSource,
  rowKey,
  loading,
  pagination = { pageSize: 20 },
  size = 'sm',
  emptyText,
  defaultSortKey,
  defaultSortDir = 'desc',
}: Props<T>) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null)
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir)
  const pageSize = pagination === false ? dataSource.length || 1 : (pagination.pageSize ?? 20)

  useEffect(() => {
    setPage(1)
  }, [dataSource, sortKey, sortDir])

  const sorted = useMemo(() => {
    if (!sortKey) return dataSource
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sorter) return dataSource
    const rows = [...dataSource]
    const dir = sortDir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      if (typeof col.sorter === 'function') {
        return col.sorter(a, b) * dir
      }
      const va = resolveSortValue(col, a)
      const vb = resolveSortValue(col, b)
      const aEmpty = va == null || va === '' || va === -1
      const bEmpty = vb == null || vb === '' || vb === -1
      if (aEmpty && bEmpty) return 0
      if (aEmpty) return 1
      if (bEmpty) return -1
      return compareValues(va, vb) * dir
    })
    return rows
  }, [dataSource, columns, sortKey, sortDir])

  const total = sorted.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1)
  const current = Math.min(page, totalPages)

  const pageRows = useMemo(() => {
    if (pagination === false) return sorted
    const start = (current - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [sorted, current, pageSize, pagination])

  const resolveKey = (record: T, index: number) => {
    if (typeof rowKey === 'function') return String(rowKey(record))
    const v = record[rowKey]
    return v == null ? String(index) : String(v)
  }

  const onHeaderClick = (col: Column<T>) => {
    if (!col.sorter) return
    if (sortKey !== col.key) {
      setSortKey(col.key)
      setSortDir(defaultSortDir)
      return
    }
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
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
              {columns.map((col) => {
                const active = sortKey === col.key
                const marker = !col.sorter ? null : active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'
                return (
                  <th
                    key={col.key}
                    style={col.width ? { width: col.width } : undefined}
                    className={col.className}
                  >
                    {col.sorter ? (
                      <button
                        type="button"
                        className={`btn btn-ghost btn-xs h-auto min-h-0 px-0 font-bold ${
                          active ? 'text-primary' : ''
                        }`}
                        onClick={() => onHeaderClick(col)}
                      >
                        {col.title}
                        <span className="opacity-60 font-normal">{marker}</span>
                      </button>
                    ) : (
                      col.title
                    )}
                  </th>
                )
              })}
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
