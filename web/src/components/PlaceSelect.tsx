import { Select, type SelectProps } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '../api/client'
import { message } from 'antd'

type MapHit = { id: number; name: string; name_zh: string }
type AreaHit = { id: number; name: string; name_zh: string }
type TeleHit = { id: number; name: string; map: number; map_name?: string }

type MapProps = Omit<SelectProps<number>, 'options' | 'onSearch' | 'showSearch' | 'filterOption'> & {
  value?: number
  onChange?: (value: number | null) => void
}

export function MapSelect({ value, onChange, ...rest }: MapProps) {
  const { t } = useTranslation()
  const [options, setOptions] = useState<{ value: number; label: string }[]>([])
  const [loading, setLoading] = useState(false)

  const search = useCallback(
    async (q: string) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ limit: '80' })
        if (q.trim()) params.set('q', q.trim())
        const data = await api<{ items: MapHit[] }>(`/api/v1/catalog/maps?${params}`)
        setOptions(data.items.map((i) => ({ value: i.id, label: `#${i.id} ${i.name}` })))
      } catch (err) {
        message.error(errorMessage(err, t))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  useEffect(() => {
    void search(value != null ? String(value) : '')
  }, [])

  const merged = useMemo(() => {
    if (value != null && !options.some((o) => o.value === value)) {
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
      placeholder={t('catalog.mapPlaceholder')}
      onSearch={(q) => void search(q)}
      onChange={(v) => onChange?.(v ?? null)}
      style={{ minWidth: 200, ...((rest.style as object) || {}) }}
      {...rest}
    />
  )
}

type AreaProps = Omit<SelectProps<number>, 'options' | 'onSearch' | 'showSearch' | 'filterOption'> & {
  value?: number
  onChange?: (value: number | null) => void
}

export function AreaSelect({ value, onChange, ...rest }: AreaProps) {
  const { t } = useTranslation()
  const [options, setOptions] = useState<{ value: number; label: string }[]>([])
  const [loading, setLoading] = useState(false)

  const search = useCallback(
    async (q: string) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ limit: '80' })
        if (q.trim()) params.set('q', q.trim())
        const data = await api<{ items: AreaHit[] }>(`/api/v1/catalog/areas?${params}`)
        setOptions(data.items.map((i) => ({ value: i.id, label: `#${i.id} ${i.name}` })))
      } catch (err) {
        message.error(errorMessage(err, t))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  useEffect(() => {
    void search(value != null ? String(value) : '')
  }, [])

  const merged = useMemo(() => {
    if (value != null && !options.some((o) => o.value === value)) {
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
      placeholder={t('catalog.areaPlaceholder')}
      onSearch={(q) => void search(q)}
      onChange={(v) => onChange?.(v ?? null)}
      style={{ minWidth: 200, ...((rest.style as object) || {}) }}
      {...rest}
    />
  )
}

type TeleProps = Omit<SelectProps<string>, 'options' | 'onSearch' | 'showSearch' | 'filterOption'> & {
  value?: string
  onChange?: (value: string | null) => void
}

/** Teleport destination picker (game_tele.name), labels include Chinese map name. */
export function TeleSelect({ value, onChange, ...rest }: TeleProps) {
  const { t } = useTranslation()
  const [options, setOptions] = useState<{ value: string; label: string }[]>([])
  const [loading, setLoading] = useState(false)

  const search = useCallback(
    async (q: string) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ limit: '80' })
        if (q.trim()) params.set('q', q.trim())
        const data = await api<{ items: TeleHit[] }>(`/api/v1/teleports?${params}`)
        setOptions(
          data.items.map((i) => ({
            value: i.name,
            label: i.map_name
              ? `${i.name} · ${i.map_name} (#${i.map})`
              : t('characters.teleMapLabel', { name: i.name, map: i.map }),
          })),
        )
      } catch (err) {
        message.error(errorMessage(err, t))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  useEffect(() => {
    void search('')
  }, [])

  return (
    <Select
      showSearch
      allowClear
      filterOption={false}
      loading={loading}
      options={options}
      value={value}
      placeholder={t('catalog.telePlaceholder')}
      onSearch={(q) => void search(q)}
      onChange={(v) => onChange?.(v ?? null)}
      style={{ minWidth: 260, ...((rest.style as object) || {}) }}
      {...rest}
    />
  )
}
