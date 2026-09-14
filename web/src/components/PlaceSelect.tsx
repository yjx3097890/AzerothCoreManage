import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '../api/client'
import { SearchSelect, toast } from '../ui'
import { isZhLocale, localizedSearchText, pickLocalizedName } from '../utils/localeLabel'

type MapHit = { id: number; name: string; name_zh?: string; name_en?: string }
type AreaHit = { id: number; name: string; name_zh?: string; name_en?: string }
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
  const { t, i18n } = useTranslation()
  const [options, setOptions] = useState<{ value: number; label: string; searchText: string }[]>([])
  const [loading, setLoading] = useState(false)
  const zhUI = isZhLocale(i18n.language)

  const search = useCallback(
    async (q: string) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ limit: '80' })
        if (q.trim()) params.set('q', q.trim())
        const data = await api<{ items: MapHit[] }>(`/api/v1/catalog/maps?${params}`)
        setOptions(
          data.items.map((i) => {
            const name = pickLocalizedName(zhUI, i)
            return {
              value: i.id,
              label: `#${i.id} ${name}`,
              searchText: localizedSearchText(i, [i.id]),
            }
          }),
        )
      } catch (err) {
        toast.error(errorMessage(err, t))
      } finally {
        setLoading(false)
      }
    },
    [t, zhUI],
  )

  useEffect(() => {
    void search(value != null ? String(value) : '')
  }, [search, value])

  const merged = useMemo(() => {
    if (value != null && !options.some((o) => o.value === value)) {
      return [{ value, label: `#${value}`, searchText: String(value) }, ...options]
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
  const { t, i18n } = useTranslation()
  const [options, setOptions] = useState<{ value: number; label: string; searchText: string }[]>([])
  const [loading, setLoading] = useState(false)
  const zhUI = isZhLocale(i18n.language)

  const search = useCallback(
    async (q: string) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ limit: '80' })
        if (q.trim()) params.set('q', q.trim())
        const data = await api<{ items: AreaHit[] }>(`/api/v1/catalog/areas?${params}`)
        setOptions(
          data.items.map((i) => {
            const name = pickLocalizedName(zhUI, i)
            return {
              value: i.id,
              label: `#${i.id} ${name}`,
              searchText: localizedSearchText(i, [i.id]),
            }
          }),
        )
      } catch (err) {
        toast.error(errorMessage(err, t))
      } finally {
        setLoading(false)
      }
    },
    [t, zhUI],
  )

  useEffect(() => {
    void search(value != null ? String(value) : '')
  }, [search, value])

  const merged = useMemo(() => {
    if (value != null && !options.some((o) => o.value === value)) {
      return [{ value, label: `#${value}`, searchText: String(value) }, ...options]
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

/** Teleport destination picker (game_tele.name); labels follow UI language only. */
export function TeleSelect({ value, onChange, onSelectHit, mapFilter, disabled, className }: TeleProps) {
  const { t, i18n } = useTranslation()
  const [hits, setHits] = useState<TeleHit[]>([])
  const [loading, setLoading] = useState(false)
  const zhUI = isZhLocale(i18n.language)

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

  const options = useMemo(
    () =>
      hits.map((i) => {
        const labelName = pickLocalizedName(zhUI, {
          name: i.name,
          name_zh: i.name_zh,
          name_en: i.name,
          display_name: i.display_name,
        })
        const mapPart = i.map_name ? `${i.map_name} (#${i.map})` : `#${i.map}`
        return {
          value: i.name,
          label: `${labelName} · ${mapPart}`,
          searchText: localizedSearchText(
            { name: i.name, name_zh: i.name_zh, display_name: i.display_name },
            [i.map, i.map_name, i.id],
          ),
        }
      }),
    [hits, zhUI],
  )

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
  const { t, i18n } = useTranslation()
  const [options, setOptions] = useState<{ value: number; label: string; searchText: string }[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)
  const zhUI = isZhLocale(i18n.language)

  const fetchItems = useCallback(
    async (q: string) => {
      const my = ++seq.current
      setLoading(true)
      try {
        const params = new URLSearchParams({ limit: '120' })
        if (q.trim()) params.set('q', q.trim())
        const data = await api<{ items: CreatureHit[] }>(`/api/v1/catalog/creatures?${params}`)
        if (my !== seq.current) return
        setOptions(
          data.items.map((i) => {
            const name = pickLocalizedName(zhUI, i)
            return {
              value: i.entry,
              label: `#${i.entry} ${name}`,
              searchText: localizedSearchText(i, [i.entry, i.id]),
            }
          }),
        )
      } catch (err) {
        if (my !== seq.current) return
        toast.error(errorMessage(err, t))
      } finally {
        if (my === seq.current) setLoading(false)
      }
    },
    [t, zhUI],
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
      return [{ value, label: `#${value}`, searchText: String(value) }, ...options]
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
  const { t, i18n } = useTranslation()
  const [options, setOptions] = useState<{ value: number; label: string; searchText: string }[]>([])
  const [loading, setLoading] = useState(false)
  const zhUI = isZhLocale(i18n.language)

  const search = useCallback(
    async (q: string) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ limit: '500' })
        if (q.trim()) params.set('q', q.trim())
        const data = await api<{ items: EventHit[] }>(`/api/v1/catalog/events?${params}`)
        setOptions(
          data.items.map((i) => ({
            value: i.id,
            label: `#${i.id} ${pickLocalizedName(zhUI, i)}`,
            searchText: localizedSearchText(i, [i.id]),
          })),
        )
      } catch (err) {
        toast.error(errorMessage(err, t))
      } finally {
        setLoading(false)
      }
    },
    [t, zhUI],
  )

  useEffect(() => {
    void search('')
  }, [search])

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
