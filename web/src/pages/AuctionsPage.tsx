import { Button, Space, Table, Typography, message } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '../api/client'

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
      message.error(errorMessage(err, t))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('pages.auctions.title')}
        </Typography.Title>
        <Button onClick={() => void load()}>{t('common.refresh')}</Button>
      </Space>
      <Table
        loading={loading}
        rowKey="id"
        dataSource={items}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 80 },
          { title: t('characters.itemEntry'), dataIndex: 'item_entry', width: 100 },
          { title: t('characters.itemName'), dataIndex: 'item_name' },
          { title: t('mail.count'), dataIndex: 'count', width: 70 },
          { title: t('auctions.owner'), dataIndex: 'owner_name' },
          { title: t('auctions.bid'), dataIndex: 'bid' },
          { title: t('auctions.buyout'), dataIndex: 'buyout' },
        ]}
      />
    </div>
  )
}
