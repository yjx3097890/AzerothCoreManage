import { Button, Select, Space, Table, Typography, message } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '../api/client'

type TablesResp = { db: string; tables: string[] }
type RowsResp = {
  db: string
  table: string
  columns: string[]
  items: Record<string, unknown>[]
  readonly: boolean
}

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
      message.error(errorMessage(err, t))
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
      message.error(errorMessage(err, t))
      setColumns([])
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [db, table, limit, t])

  useEffect(() => {
    void loadTables()
  }, [loadTables])

  const tableColumns = useMemo(
    () =>
      columns.map((col) => ({
        title: col,
        dataIndex: col,
        key: col,
        ellipsis: true,
        render: (v: unknown) => (v == null ? '-' : String(v)),
      })),
    [columns],
  )

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('pages.sql.title')}
        </Typography.Title>
        <Typography.Text type="secondary">{t('sql.readonly')}</Typography.Text>
      </Space>

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          style={{ width: 160 }}
          value={db}
          options={DBS.map((d) => ({ value: d, label: d }))}
          onChange={(v) => setDb(v)}
        />
        <Select
          style={{ width: 220 }}
          allowClear
          placeholder={t('sql.table')}
          value={table}
          options={tables.map((name) => ({ value: name, label: name }))}
          onChange={(v) => setTable(v)}
        />
        <Select
          style={{ width: 100 }}
          value={limit}
          options={[20, 50, 100, 200].map((n) => ({ value: n, label: String(n) }))}
          onChange={(v) => setLimit(v)}
        />
        <Button type="primary" disabled={!table} loading={loading} onClick={() => void loadRows()}>
          {t('common.search')}
        </Button>
        <Button onClick={() => void loadTables()}>{t('common.refresh')}</Button>
      </Space>

      <Table
        size="small"
        loading={loading}
        rowKey={(_, i) => String(i)}
        dataSource={rows}
        columns={tableColumns}
        scroll={{ x: true }}
        pagination={{ pageSize: 20 }}
        locale={{ emptyText: t('sql.empty') }}
      />
    </div>
  )
}
