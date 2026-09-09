import { Select, type SelectProps, message } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '../api/client'

type ItemHit = { id: number; entry: number; name: string; name_en: string; name_zh: string }

type Props = Omit<SelectProps<number>, 'options' | 'onSearch' | 'showSearch' | 'filterOption'> & {
  value?: number
  onChange?: (value: number | null) => void
}

export function ItemSelect({ value, onChange, ...rest }: Props) {
  const { t } = useTranslation()
  const [options, setOptions] = useState<{ value: number; label: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
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
        setSearched(Boolean(q.trim()))
        setOptions(
          data.items.map((i) => ({
            value: i.entry,
            label: `#${i.entry} ${i.name}`,
          })),
        )
      } catch (err) {
        if (my !== seq.current) return
        message.error(errorMessage(err, t))
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

  // Resolve label for the currently selected entry.
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
    <Select
      showSearch
      allowClear
      filterOption={false}
      loading={loading}
      options={merged}
      value={value}
      placeholder={t('catalog.itemPlaceholder')}
      notFoundContent={
        loading
          ? t('common.loading')
          : searched
            ? t('catalog.itemEmpty')
            : t('catalog.itemSearchHint')
      }
      onSearch={searchDebounced}
      onDropdownVisibleChange={(open) => {
        if (open && options.length === 0 && value == null) {
          // Keep empty until user types; hint via notFoundContent.
          setSearched(false)
        }
      }}
      onChange={(v) => onChange?.(v ?? null)}
      style={{ minWidth: 260, ...((rest.style as object) || {}) }}
      {...rest}
    />
  )
}
