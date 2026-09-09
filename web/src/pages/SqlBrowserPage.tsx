import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '../api/client'
import { DataTable, Select, toast, type Column } from '../ui'

type TablesResp = { db: string; tables: string[] }
type RowsResp = {
  db: string
  table: string
  columns: string[]
  items: Record<string, unknown>[]
  readonly: boolean
}

type IndexedRow = { index: number; data: Record<string, unknown> }

const DBS = ['auth', 'characters', 'world', 'playerbots'] as const

export function SqlBrowserPage() {
  const { t } = useTranslation()
  const [db, setDb] = useState<string>('characters')
  const [tables, setTables] = useState<string[]>([])
  const [table, setTable] = useState<string | undefined>()
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(false)
  const [limit, setLimit] = useState(50)

  const loadTables = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<TablesResp>(`/api/v1/sql?db=${encodeURIComponent(db)}`)
      setTables((data.tables ?? []).slice().sort())
      setTable(undefined)
      setColumns([])
      setRows([])
    } catch (err) {
      toast.error(errorMessage(err, t))
      setTables([])
    } finally {
      setLoading(false)
    }
  }, [db, t])

  const loadRows = useCallback(async () => {
    if (!table) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        db,
        table,
        limit: String(limit),
      })
      const data = await api<RowsResp>(`/api/v1/sql?${params}`)
      setColumns(data.columns ?? [])
      setRows(data.items ?? [])
    } catch (err) {
      toast.error(errorMessage(err, t))
      setColumns([])
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [db, table, limit, t])

  useEffect(() => {
    void loadTables()
  }, [loadTables])

  const dataSource = useMemo<IndexedRow[]>(() => rows.map((data, index) => ({ index, data })), [rows])

  const tableColumns = useMemo<Column<IndexedRow>[]>(
    () =>
      columns.map((col) => ({
        key: col,
        title: col,
        render: (_v, record) => {
          const value = record.data[col]
          return (
            <span className="block max-w-[280px] truncate" title={value == null ? undefined : String(value)}>
              {value == null ? '-' : String(value)}
            </span>
          )
        },
      })),
    [columns],
  )

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-semibold m-0">{t('pages.sql.title')}</h1>
        <span className="text-sm text-base-content/60">{t('sql.readonly')}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select
          className="w-40"
          value={db}
          options={DBS.map((d) => ({ value: d, label: d }))}
          onChange={(v) => setDb(v ?? 'characters')}
        />
        <Select
          className="w-56"
          allowClear
          placeholder={t('sql.table')}
          value={table ?? ''}
          options={tables.map((name) => ({ value: name, label: name }))}
          onChange={(v) => setTable(v)}
        />
        <Select
          className="w-24"
          value={limit}
          options={[20, 50, 100, 200].map((n) => ({ value: n, label: String(n) }))}
          onChange={(v) => setLimit(v ?? 50)}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!table || loading}
          onClick={() => void loadRows()}
        >
          {loading && <span className="loading loading-spinner loading-xs" />}
          {t('common.search')}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void loadTables()}>
          {t('common.refresh')}
        </button>
      </div>

      <DataTable
        rowKey="index"
        loading={loading}
        dataSource={dataSource}
        columns={tableColumns}
        pagination={{ pageSize: 20 }}
        emptyText={t('sql.empty')}
      />
    </div>
  )
}
