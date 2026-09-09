import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '../api/client'
import { DataTable, toast, type Column } from '../ui'

type Auction = {
  id: number
  item_entry: number
  item_name: string
  count: number
  owner_name: string
  buyout: number
  bid: number
  start_bid: number
}

export function AuctionsPage() {
  const { t } = useTranslation()
  const [items, setItems] = useState<Auction[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ items: Auction[] }>('/api/v1/auctions?limit=100')
      setItems(data.items)
    } catch (err) {
      toast.error(errorMessage(err, t))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const columns: Column<Auction>[] = [
    { key: 'id', title: 'ID', dataIndex: 'id', width: 80 },
    { key: 'item_entry', title: t('characters.itemEntry'), dataIndex: 'item_entry', width: 100 },
    { key: 'item_name', title: t('characters.itemName'), dataIndex: 'item_name' },
    { key: 'count', title: t('mail.count'), dataIndex: 'count', width: 70 },
    { key: 'owner_name', title: t('auctions.owner'), dataIndex: 'owner_name' },
    { key: 'bid', title: t('auctions.bid'), dataIndex: 'bid' },
    { key: 'buyout', title: t('auctions.buyout'), dataIndex: 'buyout' },
  ]

  return (
    <div>
      <div className="flex w-full items-center justify-between gap-2 mb-4">
        <h2 className="text-xl font-semibold m-0">{t('pages.auctions.title')}</h2>
        <button type="button" className="btn btn-sm" onClick={() => void load()}>
          {t('common.refresh')}
        </button>
      </div>
      <DataTable loading={loading} rowKey="id" dataSource={items} columns={columns} />
    </div>
  )
}
