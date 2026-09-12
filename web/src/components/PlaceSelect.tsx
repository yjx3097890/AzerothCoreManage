import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '../api/client'
import { SearchSelect, toast } from '../ui'

type MapHit = { id: number; name: string; name_zh: string }
type AreaHit = { id: number; name: string; name_zh: string }
type TeleHit = {
  id: number
  name: string
  name_zh?: string
  display_name?: string
  map: number
  map_name?: string
  x: number
  y: number
  z: number
  orientation?: number
}

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
  onSelectHit?: (hit: TeleHit | null) => void
  mapFilter?: number | null
  disabled?: boolean
  className?: string
}

/** Teleport destination picker (game_tele.name); ZH UI shows/search Chinese labels. */
export function TeleSelect({ value, onChange, onSelectHit, mapFilter, disabled, className }: TeleProps) {
  const { t, i18n } = useTranslation()
  const [hits, setHits] = useState<TeleHit[]>([])
  const [loading, setLoading] = useState(false)
  const zhUI = i18n.language.toLowerCase().startsWith('zh')

  const search = useCallback(
    async (q: string) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ limit: '80' })
        if (q.trim()) params.set('q', q.trim())
        if (mapFilter != null && mapFilter >= 0) params.set('map', String(mapFilter))
        const data = await api<{ items: TeleHit[] }>(`/api/v1/teleports?${params}`)
        setHits(data.items)
      } catch (err) {
        toast.error(errorMessage(err, t))
      } finally {
        setLoading(false)
      }
    },
    [t, mapFilter],
  )

  useEffect(() => {
    void search('')
  }, [search, i18n.language])

  const options = hits.map((i) => {
    const labelName = zhUI ? i.display_name || i.name_zh || i.name : i.name
    const mapPart = i.map_name ? `${i.map_name} (#${i.map})` : `#${i.map}`
    const label =
      zhUI && i.name_zh && i.name_zh !== i.name
        ? `${labelName} · ${mapPart}`
        : i.map_name
          ? `${labelName} · ${mapPart}`
          : t('characters.teleMapLabel', { name: labelName, map: i.map })
    return { value: i.name, label }
  })

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
      onChange={(v) => {
        onChange?.(v ?? null)
        if (!v) {
          onSelectHit?.(null)
          return
        }
        onSelectHit?.(hits.find((h) => h.name === v) ?? null)
      }}
    />
  )
}

type CreatureHit = { id: number; entry: number; name: string; name_en: string; name_zh: string }

type CreatureProps = {
  value?: number
  onChange?: (value: number | null) => void
  disabled?: boolean
  className?: string
}

export function CreatureSelect({ value, onChange, disabled, className }: CreatureProps) {
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
        const data = await api<{ items: CreatureHit[] }>(`/api/v1/catalog/creatures?${params}`)
        if (my !== seq.current) return
        setOptions(data.items.map((i) => ({ value: i.entry, label: `#${i.entry} ${i.name}` })))
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
      placeholder={t('catalog.creaturePlaceholder')}
      onSearch={searchDebounced}
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
