import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '../api/client'
import { SearchSelect, toast } from '../ui'

type ItemHit = { id: number; entry: number; name: string; name_en: string; name_zh: string }

type Props = {
  value?: number
  onChange?: (value: number | null) => void
  disabled?: boolean
  className?: string
}

export function ItemSelect({ value, onChange, disabled, className }: Props) {
  const { t } = useTranslation()
  const [options, setOptions] = useState<{ value: number; label: string }[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  const fetchItems = useCallback(
    async (q: string) => {
      const my = ++seq.current
      setLoading(true)
      try {
        const params = new URLSearchParams({ limit: '120' })
        if (q.trim()) params.set('q', q.trim())
        const data = await api<{ items: ItemHit[] }>(`/api/v1/catalog/items?${params}`)
        if (my !== seq.current) return
        setOptions(
          data.items.map((i) => ({
            value: i.entry,
            label: `#${i.entry} ${i.name}`,
          })),
        )
      } catch (err) {
        if (my !== seq.current) return
        toast.error(errorMessage(err, t))
      } finally {
        if (my === seq.current) setLoading(false)
      }
    },
    [t],
  )

  const searchDebounced = useCallback(
    (q: string) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void fetchItems(q), 280)
    },
    [fetchItems],
  )

  useEffect(() => {
    if (value == null) return
    if (options.some((o) => o.value === value)) return
    void fetchItems(String(value))
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const merged = useMemo(() => {
    if (value && !options.some((o) => o.value === value)) {
      return [{ value, label: `#${value}` }, ...options]
    }
    return options
  }, [options, value])

  return (
    <SearchSelect
      className={className ?? 'min-w-[260px]'}
      allowClear
      disabled={disabled}
      loading={loading}
      options={merged}
      value={value}
      placeholder={t('catalog.itemPlaceholder')}
      onSearch={searchDebounced}
      onChange={(v) => onChange?.(v ?? null)}
    />
  )
}
