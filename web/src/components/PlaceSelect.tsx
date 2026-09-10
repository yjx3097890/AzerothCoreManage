import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '../api/client'
import { SearchSelect, toast } from '../ui'

type MapHit = { id: number; name: string; name_zh: string }
type AreaHit = { id: number; name: string; name_zh: string }
type TeleHit = { id: number; name: string; map: number; map_name?: string }

type NumProps = {
  value?: number
  onChange?: (value: number | null) => void
  disabled?: boolean
  className?: string
}

export function MapSelect({ value, onChange, disabled, className }: NumProps) {
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
        toast.error(errorMessage(err, t))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  useEffect(() => {
    void search(value != null ? String(value) : '')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const merged = useMemo(() => {
    if (value != null && !options.some((o) => o.value === value)) {
      return [{ value, label: `#${value}` }, ...options]
    }
    return options
  }, [options, value])

  return (
    <SearchSelect
      className={className ?? 'min-w-[200px]'}
      allowClear
      disabled={disabled}
      loading={loading}
      options={merged}
      value={value}
      placeholder={t('catalog.mapPlaceholder')}
      onSearch={(q) => void search(q)}
      onChange={(v) => onChange?.(v ?? null)}
    />
  )
}

export function AreaSelect({ value, onChange, disabled, className }: NumProps) {
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
        toast.error(errorMessage(err, t))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  useEffect(() => {
    void search(value != null ? String(value) : '')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const merged = useMemo(() => {
    if (value != null && !options.some((o) => o.value === value)) {
      return [{ value, label: `#${value}` }, ...options]
    }
    return options
  }, [options, value])

  return (
    <SearchSelect
      className={className ?? 'min-w-[200px]'}
      allowClear
      disabled={disabled}
      loading={loading}
      options={merged}
      value={value}
      placeholder={t('catalog.areaPlaceholder')}
      onSearch={(q) => void search(q)}
      onChange={(v) => onChange?.(v ?? null)}
    />
  )
}

type TeleProps = {
  value?: string
  onChange?: (value: string | null) => void
  disabled?: boolean
  className?: string
}

/** Teleport destination picker (game_tele.name), labels include Chinese map name. */
export function TeleSelect({ value, onChange, disabled, className }: TeleProps) {
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
        toast.error(errorMessage(err, t))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  useEffect(() => {
    void search('')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SearchSelect
      className={className ?? 'min-w-[260px]'}
      allowClear
      disabled={disabled}
      loading={loading}
      options={options}
      value={value}
      placeholder={t('catalog.telePlaceholder')}
      onSearch={(q) => void search(q)}
      onChange={(v) => onChange?.(v ?? null)}
    />
  )
}

type EventHit = { id: number; name: string; name_zh: string; name_en: string }

/** World event picker (game_event id + localized name). */
export function EventSelect({ value, onChange, disabled, className }: NumProps) {
  const { t } = useTranslation()
  const [options, setOptions] = useState<{ value: number; label: string; searchText: string }[]>([])
  const [loading, setLoading] = useState(false)

  const search = useCallback(
    async (q: string) => {
      setLoading(true)
      try {
        // Full catalog is small (~180); load all so local SearchSelect filter covers everything.
        const params = new URLSearchParams({ limit: '500' })
        if (q.trim()) params.set('q', q.trim())
        const data = await api<{ items: EventHit[] }>(`/api/v1/catalog/events?${params}`)
        setOptions(
          data.items.map((i) => ({
            value: i.id,
            label: `#${i.id} ${i.name}`,
            searchText: `${i.id} ${i.name} ${i.name_zh || ''} ${i.name_en || ''}`,
          })),
        )
      } catch (err) {
        toast.error(errorMessage(err, t))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  useEffect(() => {
    // Always load full list once; typing filters locally in SearchSelect.
    void search('')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const merged = useMemo(() => {
    if (value != null && !options.some((o) => o.value === value)) {
      return [{ value, label: `#${value}`, searchText: String(value) }, ...options]
    }
    return options
  }, [options, value])

  return (
    <SearchSelect
      className={className ?? 'min-w-[220px]'}
      allowClear
      disabled={disabled}
      loading={loading}
      options={merged}
      value={value}
      placeholder={t('events.eventPlaceholder')}
      onSearch={undefined}
      onChange={(v) => onChange?.(v ?? null)}
    />
  )
}
