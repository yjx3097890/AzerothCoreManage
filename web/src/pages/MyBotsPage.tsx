import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, getTargetId, getToken, hasMinRole } from '../api/client'
import { ConfirmDanger } from '../components/ConfirmDanger'
import { MapPointPicker, type MapPick, type MapPoint } from '../components/MapPointPicker'
import { CreatureSelect } from '../components/PlaceSelect'
import { currentLocale } from '../i18n'
import { DataTable, Select, Tabs, toast, type Column } from '../ui'

type Status = {
  configured: boolean
  enabled: boolean
  host: string
  port: number
  has_token: boolean
  health?: { ok?: boolean; service?: string; version?: string; error?: string } | null
}

type CharacterSnap = {
  ok?: boolean
  online?: boolean
  guid?: number
  name?: string
  selfbot?: boolean
  map?: number
  map_name?: string
  zone?: number
  zone_name?: string
  x?: number
  y?: number
  z?: number
  level?: number
  class?: number
  class_name?: string
  hp?: [number, number]
  power?: [number, number]
  job?: Job | null
  latencyMs?: number
}

type Job = {
  id?: string
  jobId?: string
  status?: string
  type?: string
  steps?: { op?: string; detail?: string; result?: string }[]
  error?: string
}

type EventRow = {
  id: number
  jobId?: string
  kind: string
  message?: string
  createdAt?: number
}

type Patrol = {
  id: string
  name?: string
  waypoints?: { x: number; y: number; z: number; wait?: number }[]
}

type QuestItem = {
  questId: number
  title: string
  status?: number
  status_label?: string
  questLevel?: number
  minLevel?: number
  completable?: boolean
  giverEntry?: number
  turninEntry?: number
  heuristic?: boolean
}

type TeleHit = { id: number; name: string; map: number; map_name?: string; x: number; y: number; z: number }

type OnlineChar = {
  guid: number
  name: string
  level: number
  class_name?: string
  map_name?: string
  zone_name?: string
  account?: string
}

type JobType = 'move_to' | 'complete_quest' | 'patrol' | 'script'

function PanelIntro({ children }: { children: ReactNode }) {
  return <p className="text-sm text-base-content/65 m-0 mb-4 leading-relaxed max-w-3xl">{children}</p>
}

function StatCard({ title, desc, value }: { title: string; desc: string; value: string | number }) {
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body p-4 gap-1">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-base-content/55 leading-relaxed">{desc}</span>
        <span className="text-2xl font-semibold mt-1">{value}</span>
      </div>
    </div>
  )
}

export function MyBotsPage() {
  const { t } = useTranslation()
  const gm = hasMinRole('gm')
  const [tab, setTab] = useState('command')
  const [status, setStatus] = useState<Status | null>(null)
  const [charId, setCharId] = useState('')
  const [activeChar, setActiveChar] = useState('')
  const [onlineChars, setOnlineChars] = useState<OnlineChar[]>([])
  const [onlineLoading, setOnlineLoading] = useState(false)
  const [liveOk, setLiveOk] = useState(false)
  const liveAbortRef = useRef<AbortController | null>(null)
  const [snap, setSnap] = useState<CharacterSnap | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [jobDetail, setJobDetail] = useState<Job | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])
  const [patrols, setPatrols] = useState<Patrol[]>([])
  const [telePoints, setTelePoints] = useState<TeleHit[]>([])
  const [questLog, setQuestLog] = useState<QuestItem[]>([])
  const [questAvail, setQuestAvail] = useState<QuestItem[]>([])
  const [pending, setPending] = useState<{ title: string; description: string; run: () => Promise<void> } | null>(
    null,
  )
  const [creatureEntry, setCreatureEntry] = useState<number | null>(null)

  const [jobType, setJobType] = useState<JobType>('move_to')
  const [moveMode, setMoveMode] = useState<'xyz' | 'entry'>('xyz')
  const [moveX, setMoveX] = useState('')
  const [moveY, setMoveY] = useState('')
  const [moveZ, setMoveZ] = useState('')
  const [moveDist, setMoveDist] = useState('2.5')
  const [moveEntry, setMoveEntry] = useState('')
  const [questId, setQuestId] = useState('')
  const [giverEntry, setGiverEntry] = useState('')
  const [turninEntry, setTurninEntry] = useState('')
  const [patrolId, setPatrolId] = useState('')
  const [scriptSteps, setScriptSteps] = useState('[\n  {"op":"wait","detail":"{\\"seconds\\":3}"}\n]')
  const [replaceJob, setReplaceJob] = useState(true)
  const [patrolFormId, setPatrolFormId] = useState('')
  const [patrolFormName, setPatrolFormName] = useState('')
  const [patrolFormWaypoints, setPatrolFormWaypoints] = useState(
    '[\n  {"x":-8895,"y":-133,"z":80,"wait":2},\n  {"x":-8949,"y":-132,"z":83,"wait":2}\n]',
  )

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api<Status>('/api/v1/mybots/status'))
    } catch (err) {
      toast.error(errorMessage(err, t))
    }
  }, [t])

  const loadOnlineCharacters = useCallback(async () => {
    setOnlineLoading(true)
    try {
      const data = await api<{ items: OnlineChar[] }>('/api/v1/characters?online=1&limit=200')
      setOnlineChars(data.items ?? [])
    } catch (err) {
      setOnlineChars([])
      toast.error(errorMessage(err, t))
    } finally {
      setOnlineLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    if (status?.configured) void loadOnlineCharacters()
  }, [status?.configured, loadOnlineCharacters])

  const charOptions = useMemo(() => {
    const opts = onlineChars.map((c) => ({
      value: c.name,
      label: [c.name, `Lv${c.level}`, c.class_name, c.zone_name || c.map_name].filter(Boolean).join(' · '),
    }))
    if (charId && !opts.some((o) => o.value === charId)) {
      opts.unshift({ value: charId, label: charId })
    }
    return opts
  }, [onlineChars, charId])

  const loadCharacter = async (id: string) => {
    const key = id.trim()
    if (!key) return null
    try {
      const data = await api<CharacterSnap>(`/api/v1/mybots/characters/${encodeURIComponent(key)}`)
      setSnap(data)
      setActiveChar(key)
      setCharId(key)
      return data
    } catch (err) {
      setSnap(null)
      toast.error(errorMessage(err, t))
      return null
    }
  }

  const loadJobs = async (id: string) => {
    const key = id.trim()
    if (!key) return
    try {
      const data = await api<{ jobs?: Job[]; items?: Job[] }>(
        `/api/v1/mybots/characters/${encodeURIComponent(key)}/jobs`,
      )
      setJobs(data.jobs ?? data.items ?? [])
    } catch (err) {
      setJobs([])
      toast.error(errorMessage(err, t))
    }
  }

  const loadEvents = async (id: string) => {
    const key = id.trim()
    if (!key) return
    try {
      const data = await api<{ events?: EventRow[] }>(
        `/api/v1/mybots/characters/${encodeURIComponent(key)}/events`,
      )
      setEvents(data.events ?? [])
    } catch (err) {
      setEvents([])
      toast.error(errorMessage(err, t))
    }
  }

  const loadPatrols = async () => {
    try {
      const data = await api<{ patrols?: Patrol[]; items?: Patrol[] }>('/api/v1/mybots/patrols')
      setPatrols(data.patrols ?? data.items ?? [])
    } catch (err) {
      setPatrols([])
      toast.error(errorMessage(err, t))
    }
  }

  const loadTelePoints = async (mapId: number) => {
    try {
      const data = await api<{ items: TeleHit[] }>(`/api/v1/teleports?map=${mapId}&limit=200`)
      setTelePoints(data.items)
    } catch (err) {
      setTelePoints([])
      toast.error(errorMessage(err, t))
    }
  }

  const loadQuests = async (name: string) => {
    try {
      const key = encodeURIComponent(name)
      const [log, avail] = await Promise.all([
        api<{ items: QuestItem[]; source?: string }>(`/api/v1/characters/${key}/questlog`),
        api<{ items: QuestItem[]; source?: string; note?: string }>(`/api/v1/characters/${key}/quests/available?limit=80`),
      ])
      setQuestLog(log.items ?? [])
      setQuestAvail(avail.items ?? [])
    } catch (err) {
      setQuestLog([])
      setQuestAvail([])
      toast.error(errorMessage(err, t))
    }
  }

  const refreshCharRelated = async (id = activeChar) => {
    const key = id.trim()
    if (!key) return
    const [fresh] = await Promise.all([loadCharacter(key), loadJobs(key), loadEvents(key)])
    await loadQuests(fresh?.name || key)
  }

  const selectCharacter = (name: string | undefined) => {
    const key = (name ?? '').trim()
    setCharId(key)
    if (!key) {
      setActiveChar('')
      setSnap(null)
      setJobs([])
      setEvents([])
      setQuestLog([])
      setQuestAvail([])
      return
    }
    void refreshCharRelated(key)
  }

  const refreshPage = async () => {
    await Promise.all([loadStatus(), loadOnlineCharacters()])
    const id = (activeChar || charId).trim()
    if (id) await refreshCharRelated(id)
  }

  useEffect(() => {
    if (!snap?.map && snap?.map !== 0) return
    void loadTelePoints(snap.map)
  }, [snap?.map]) // eslint-disable-line react-hooks/exhaustive-deps

  // SSE: keep map position + quest lists in sync while a character is selected.
  useEffect(() => {
    liveAbortRef.current?.abort()
    liveAbortRef.current = null
    setLiveOk(false)
    if (!activeChar || !status?.configured) return

    const ac = new AbortController()
    liveAbortRef.current = ac

    void (async () => {
      try {
        const headers = new Headers({ Accept: 'text/event-stream' })
        const token = getToken()
        if (token) headers.set('Authorization', `Bearer ${token}`)
        headers.set('X-Locale', currentLocale())
        headers.set('Accept-Language', currentLocale())
        const target = getTargetId()
        if (target) headers.set('X-Target-Id', target)

        const res = await fetch(
          `/api/v1/mybots/characters/${encodeURIComponent(activeChar)}/live?interval=2`,
          { headers, signal: ac.signal, cache: 'no-store' },
        )
        if (!res.ok || !res.body) {
          let msg = res.statusText
          try {
            const body = (await res.json()) as { error?: { message?: string } }
            msg = body.error?.message || msg
          } catch {
            /* ignore */
          }
          throw new Error(msg || t('mybots.liveError'))
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const chunks = buffer.split('\n\n')
          buffer = chunks.pop() || ''
          for (const chunk of chunks) {
            const rawLines = chunk.split('\n')
            let event = 'message'
            const dataLines: string[] = []
            for (const line of rawLines) {
              if (line.startsWith(':')) continue
              if (line.startsWith('event:')) event = line.slice(6).trim()
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
            }
            if (!dataLines.length) continue
            try {
              const data = JSON.parse(dataLines.join('\n')) as Record<string, unknown>
              if (event === 'ready') {
                setLiveOk(true)
              } else if (event === 'snapshot') {
                setSnap(data as CharacterSnap)
                setLiveOk(true)
              } else if (event === 'quests') {
                const log = Array.isArray(data.log) ? (data.log as QuestItem[]) : []
                const available = Array.isArray(data.available) ? (data.available as QuestItem[]) : []
                setQuestLog(log)
                setQuestAvail(available)
                setLiveOk(true)
              }
            } catch {
              /* ignore malformed chunk */
            }
          }
        }
      } catch (err) {
        if (ac.signal.aborted) return
        setLiveOk(false)
        // Don't toast on every disconnect; initial load still works via refreshCharRelated.
        console.warn('mybots live SSE', err)
      } finally {
        if (liveAbortRef.current === ac) {
          liveAbortRef.current = null
          setLiveOk(false)
        }
      }
    })()

    return () => {
      ac.abort()
      if (liveAbortRef.current === ac) liveAbortRef.current = null
    }
  }, [activeChar, status?.configured, t])

  useEffect(() => {
    if (tab === 'patrols' && status?.configured) void loadPatrols()
  }, [tab, status?.configured]) // eslint-disable-line react-hooks/exhaustive-deps

  const submitJob = async (body: Record<string, unknown>) => {
    if (!activeChar || !gm || !snap?.selfbot) return
    await api(`/api/v1/mybots/characters/${encodeURIComponent(activeChar)}/jobs`, {
      method: 'POST',
      body: JSON.stringify({ replace: replaceJob, ...body }),
    })
    toast.success(t('common.ok'))
    await refreshCharRelated()
  }

  const setSelfbot = (enabled: boolean) => {
    if (!activeChar || !gm) return
    setPending({
      title: enabled ? t('mybots.enableSelfbot') : t('mybots.disableSelfbot'),
      description: t('mybots.selfbotConfirm', { name: activeChar, state: enabled ? 'on' : 'off' }),
      run: async () => {
        await api(`/api/v1/mybots/characters/${encodeURIComponent(activeChar)}/selfbot`, {
          method: 'POST',
          body: JSON.stringify({ enabled }),
        })
        await loadCharacter(activeChar)
      },
    })
  }

  const confirmMove = (pick: MapPick) => {
    if (!gm || !snap?.selfbot) return
    setPending({
      title: t('mybots.moveConfirmTitle'),
      description: t('mybots.moveConfirmDesc', {
        label: pick.label || `${pick.x.toFixed(1)}, ${pick.y.toFixed(1)}`,
        x: pick.x.toFixed(1),
        y: pick.y.toFixed(1),
        z: pick.z.toFixed(1),
      }),
      run: async () => {
        await submitJob({ type: 'move_to', x: pick.x, y: pick.y, z: pick.z, dist: 2.5 })
      },
    })
  }

  const moveToNpc = async () => {
    if (!creatureEntry || !gm || !snap?.selfbot) return
    try {
      await submitJob({ type: 'move_to', entry: creatureEntry })
    } catch (err) {
      toast.error(errorMessage(err, t))
    }
  }

  const runQuest = (q: QuestItem) => {
    if (!gm || !snap?.selfbot) return
    setPending({
      title: t('mybots.questConfirmTitle'),
      description: t('mybots.questConfirmDesc', { title: q.title, id: q.questId }),
      run: async () => {
        const body: Record<string, unknown> = { type: 'complete_quest', questId: q.questId }
        if (q.giverEntry) body.giverEntry = q.giverEntry
        if (q.turninEntry) body.turninEntry = q.turninEntry
        await submitJob(body)
      },
    })
  }

  const mapPoints: MapPoint[] = useMemo(
    () =>
      telePoints.map((p) => ({
        id: String(p.id),
        label: p.name,
        x: p.x,
        y: p.y,
        z: p.z,
        map: p.map,
      })),
    [telePoints],
  )

  const buildJobBody = (): Record<string, unknown> | null => {
    const body: Record<string, unknown> = { type: jobType, replace: replaceJob }
    if (jobType === 'move_to') {
      if (moveMode === 'entry') {
        const entry = Number(moveEntry)
        if (!entry) {
          toast.error(t('mybots.needEntry'))
          return null
        }
        body.entry = entry
      } else {
        const x = Number(moveX)
        const y = Number(moveY)
        const z = Number(moveZ)
        if ([x, y, z].some((n) => Number.isNaN(n))) {
          toast.error(t('mybots.needXYZ'))
          return null
        }
        body.x = x
        body.y = y
        body.z = z
        if (moveDist) body.dist = Number(moveDist)
      }
    } else if (jobType === 'complete_quest') {
      const qid = Number(questId)
      if (!qid) {
        toast.error(t('mybots.needQuestId'))
        return null
      }
      body.questId = qid
      if (giverEntry) body.giverEntry = Number(giverEntry)
      if (turninEntry) body.turninEntry = Number(turninEntry)
    } else if (jobType === 'patrol') {
      if (!patrolId.trim()) {
        toast.error(t('mybots.needPatrolId'))
        return null
      }
      body.patrolId = patrolId.trim()
    } else if (jobType === 'script') {
      try {
        body.steps = JSON.parse(scriptSteps) as unknown[]
      } catch {
        toast.error(t('mybots.badScriptJson'))
        return null
      }
    }
    return body
  }

  const createJob = async () => {
    if (!snap?.selfbot) {
      toast.error(t('mybots.needSelfbot'))
      return
    }
    const body = buildJobBody()
    if (!body) return
    try {
      await submitJob(body)
      setTab('jobs')
    } catch (err) {
      toast.error(errorMessage(err, t))
    }
  }

  const jobAction = (jobId: string, action: 'pause' | 'resume' | 'cancel') => {
    if (!activeChar || !gm || !jobId || !snap?.selfbot) return
    const run = async () => {
      const base = `/api/v1/mybots/characters/${encodeURIComponent(activeChar)}/jobs/${encodeURIComponent(jobId)}`
      if (action === 'cancel') await api(base, { method: 'DELETE' })
      else await api(`${base}/${action}`, { method: 'POST' })
      await refreshCharRelated()
      setJobDetail(null)
    }
    if (action === 'cancel') {
      setPending({
        title: t('mybots.cancelJob'),
        description: t('mybots.cancelJobConfirm', { id: jobId }),
        run,
      })
      return
    }
    void run()
      .then(() => toast.success(t('common.ok')))
      .catch((err) => toast.error(errorMessage(err, t)))
  }

  const healthOk = status?.health && typeof status.health === 'object' && status.health.ok === true
  const botActive = !!snap?.selfbot
  const canCommand = gm && botActive

  const jobColumns: Column<Job>[] = [
    { key: 'id', title: 'ID', render: (_v, r) => r.id ?? r.jobId ?? '-' },
    { key: 'type', title: t('mybots.jobType'), dataIndex: 'type', width: 120 },
    { key: 'status', title: t('mybots.jobStatus'), dataIndex: 'status', width: 110 },
    { key: 'error', title: t('mybots.error'), render: (_v, r) => r.error || '-' },
    {
      key: 'actions',
      title: t('common.actions'),
      width: 220,
      render: (_v, r) => {
        const id = r.id ?? r.jobId ?? ''
        return (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() =>
                void api<Job>(
                  `/api/v1/mybots/characters/${encodeURIComponent(activeChar)}/jobs/${encodeURIComponent(id)}`,
                )
                  .then(setJobDetail)
                  .catch((err) => toast.error(errorMessage(err, t)))
              }
            >
              {t('mybots.detail')}
            </button>
            {gm && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={!botActive}
                  onClick={() => jobAction(id, 'pause')}
                >
                  {t('mybots.pause')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={!botActive}
                  onClick={() => jobAction(id, 'resume')}
                >
                  {t('mybots.resume')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs text-error"
                  disabled={!botActive}
                  onClick={() => jobAction(id, 'cancel')}
                >
                  {t('confirm.cancel')}
                </button>
              </>
            )}
          </div>
        )
      },
    },
  ]

  const eventColumns: Column<EventRow>[] = [
    { key: 'id', title: 'ID', dataIndex: 'id', width: 70 },
    { key: 'kind', title: t('mybots.eventKind'), dataIndex: 'kind', width: 140 },
    { key: 'message', title: t('mybots.eventMessage'), dataIndex: 'message' },
    { key: 'jobId', title: 'Job', dataIndex: 'jobId', width: 140 },
    {
      key: 'createdAt',
      title: t('mybots.time'),
      width: 160,
      render: (_v, r) => (r.createdAt ? new Date(r.createdAt * 1000).toLocaleString() : '-'),
    },
  ]

  const questRow = (q: QuestItem) => (
    <div key={q.questId} className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-base-300">
      <div className="min-w-0">
        <div className="font-medium text-sm truncate">{q.title || `#${q.questId}`}</div>
        <div className="text-xs text-base-content/55">
          #{q.questId}
          {q.questLevel != null ? ` · Lv${q.questLevel}` : ''}
          {q.status_label ? ` · ${q.status_label}` : ''}
          {q.completable ? ` · ${t('mybots.questCompletable')}` : ''}
        </div>
      </div>
      {gm && (
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!botActive}
          title={!botActive ? t('mybots.needSelfbot') : undefined}
          onClick={() => runQuest(q)}
        >
          {t('mybots.doQuest')}
        </button>
      )}
    </div>
  )

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-semibold m-0">{t('pages.mybots.title')}</h1>
        <button type="button" className="btn btn-sm" onClick={() => void refreshPage()}>
          {t('common.refresh')}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-4 p-3 rounded-lg bg-base-100 border border-base-300">
        <label className="form-control w-full max-w-md">
          <span className="label py-0.5">
            <span className="label-text text-xs">{t('mybots.characterId')}</span>
          </span>
          <Select
            className="select-sm"
            value={charId || undefined}
            onChange={selectCharacter}
            options={charOptions}
            placeholder={onlineLoading ? t('common.loading') : t('mybots.characterPlaceholder')}
            allowClear
            disabled={!status?.configured || onlineLoading}
          />
        </label>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!status?.configured || !charId}
          onClick={() => void refreshCharRelated(charId.trim())}
        >
          {t('mybots.loadCharacter')}
        </button>
        {activeChar && snap && (
          <div className="text-sm text-base-content/70 self-center flex flex-wrap gap-2 items-center">
            <strong>{snap.name ?? activeChar}</strong>
            <span>
              {snap.map_name || `map ${snap.map}`}
              {snap.zone_name ? ` · ${snap.zone_name}` : ''}
            </span>
            <span>Lv{snap.level ?? '-'}</span>
            {snap.class_name && <span>{snap.class_name}</span>}
            {snap.online === false && <span className="badge badge-warning badge-sm">{t('mybots.offline')}</span>}
            {snap.selfbot && <span className="badge badge-success badge-sm">Selfbot</span>}
            {!snap.selfbot && <span className="badge badge-ghost badge-sm">{t('mybots.selfbotOff')}</span>}
            {liveOk && (
              <span className="badge badge-info badge-sm gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-info-content animate-pulse" />
                {t('mybots.live')}
              </span>
            )}
            {gm && (
              <>
                <button
                  type="button"
                  className="btn btn-xs btn-primary"
                  disabled={!!snap.selfbot}
                  onClick={() => setSelfbot(true)}
                >
                  {t('mybots.enableSelfbot')}
                </button>
                <button
                  type="button"
                  className="btn btn-xs"
                  disabled={!snap.selfbot}
                  onClick={() => setSelfbot(false)}
                >
                  {t('mybots.disableSelfbot')}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {activeChar && snap && !botActive && (
        <div className="alert alert-info text-sm mb-4 py-2">
          {t('mybots.needSelfbotHint')}
        </div>
      )}

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'command',
            label: t('mybots.tabCommand'),
            children: !activeChar || !snap ? (
              <p className="text-sm text-base-content/50 m-0">{t('mybots.loadFirst')}</p>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <section className={`space-y-3 ${!botActive ? 'opacity-60' : ''}`}>
                  <h3 className="text-sm font-semibold m-0">{t('mybots.moveSection')}</h3>
                  <PanelIntro>{t('mybots.moveHint')}</PanelIntro>
                  {snap.map != null && (
                    <MapPointPicker
                      key={`${snap.map}-${snap.zone ?? 'z'}`}
                      mapId={snap.map}
                      zoneId={snap.zone}
                      player={
                        snap.x != null && snap.y != null
                          ? { x: snap.x, y: snap.y, z: snap.z ?? 0 }
                          : null
                      }
                      points={mapPoints}
                      disabled={!canCommand}
                      onPick={confirmMove}
                    />
                  )}
                  <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-base-300">
                    <div className="form-control">
                      <span className="label py-0.5">
                        <span className="label-text text-xs">{t('mybots.moveToNpc')}</span>
                      </span>
                      <CreatureSelect
                        value={creatureEntry ?? undefined}
                        onChange={setCreatureEntry}
                        disabled={!canCommand}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!canCommand || !creatureEntry}
                      onClick={() => void moveToNpc()}
                    >
                      {t('mybots.goNpc')}
                    </button>
                  </div>
                  <p className="text-xs text-base-content/45 m-0">{t('mybots.mapAssetHint')}</p>
                </section>

                <section className={`space-y-4 ${!botActive ? 'opacity-60' : ''}`}>
                  <div>
                    <h3 className="text-sm font-semibold m-0 mb-1">{t('mybots.questLogSection')}</h3>
                    <PanelIntro>{t('mybots.questLogHint')}</PanelIntro>
                    <div className="max-h-64 overflow-auto rounded-lg border border-base-300 px-3 bg-base-100">
                      {questLog.length ? questLog.map(questRow) : (
                        <p className="text-sm text-base-content/50 py-4 m-0">{t('mybots.questEmpty')}</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold m-0 mb-1">{t('mybots.questAvailSection')}</h3>
                    <PanelIntro>{t('mybots.questAvailHint')}</PanelIntro>
                    <div className="max-h-64 overflow-auto rounded-lg border border-base-300 px-3 bg-base-100">
                      {questAvail.length ? questAvail.map(questRow) : (
                        <p className="text-sm text-base-content/50 py-4 m-0">{t('mybots.questEmpty')}</p>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            ),
          },
          {
            key: 'overview',
            label: t('mybots.tabOverview'),
            children: (
              <div>
                <PanelIntro>{t('mybots.overviewHint')}</PanelIntro>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatCard
                    title={t('mybots.apiStatus')}
                    desc={t('mybots.apiStatusHint')}
                    value={
                      !status
                        ? '-'
                        : !status.configured
                          ? t('mybots.notConfigured')
                          : healthOk
                            ? t('mybots.healthy')
                            : t('mybots.unreachable')
                    }
                  />
                  <StatCard
                    title={t('mybots.endpoint')}
                    desc={t('mybots.endpointHint')}
                    value={status?.configured ? `${status.host}:${status.port}` : '-'}
                  />
                  <StatCard
                    title={t('mybots.service')}
                    desc={t('mybots.serviceHint')}
                    value={
                      status?.health && 'service' in status.health ? String(status.health.service ?? '-') : '-'
                    }
                  />
                  <StatCard
                    title={t('mybots.version')}
                    desc={t('mybots.versionHint')}
                    value={
                      status?.health && 'version' in status.health ? String(status.health.version ?? '-') : '-'
                    }
                  />
                </div>
                {!status?.configured && (
                  <div className="alert alert-warning text-sm mt-4">{t('mybots.configHint')}</div>
                )}
              </div>
            ),
          },
          {
            key: 'jobs',
            label: t('mybots.tabJobs'),
            children: !activeChar ? (
              <p className="text-sm text-base-content/50 m-0">{t('mybots.loadFirst')}</p>
            ) : (
              <div className="space-y-3">
                <button type="button" className="btn btn-sm" onClick={() => void loadJobs(activeChar)}>
                  {t('common.refresh')}
                </button>
                <DataTable
                  columns={jobColumns}
                  dataSource={jobs}
                  rowKey={(r) => r.id ?? r.jobId ?? String(Math.random())}
                />
                {jobDetail && (
                  <pre className="p-3 rounded-lg border border-base-300 text-xs overflow-auto max-h-80">
                    {JSON.stringify(jobDetail, null, 2)}
                  </pre>
                )}
              </div>
            ),
          },
          {
            key: 'events',
            label: t('mybots.tabEvents'),
            children: !activeChar ? (
              <p className="text-sm text-base-content/50 m-0">{t('mybots.loadFirst')}</p>
            ) : (
              <>
                <button type="button" className="btn btn-sm mb-3" onClick={() => void loadEvents(activeChar)}>
                  {t('common.refresh')}
                </button>
                <DataTable columns={eventColumns} dataSource={events} rowKey={(r) => String(r.id)} />
              </>
            ),
          },
          {
            key: 'patrols',
            label: t('mybots.tabPatrols'),
            children: (
              <div className="space-y-3">
                <PanelIntro>{t('mybots.patrolsHint')}</PanelIntro>
                <button type="button" className="btn btn-sm" onClick={() => void loadPatrols()}>
                  {t('common.refresh')}
                </button>
                <DataTable
                  columns={[
                    { key: 'id', title: 'ID', dataIndex: 'id' },
                    { key: 'name', title: t('mybots.patrolName'), dataIndex: 'name' },
                    {
                      key: 'waypoints',
                      title: t('mybots.waypoints'),
                      render: (_v, r) => r.waypoints?.length ?? 0,
                    },
                  ]}
                  dataSource={patrols}
                  rowKey={(r) => r.id}
                />
                {gm && (
                  <section className="space-y-2 max-w-3xl p-4 rounded-lg border border-base-300">
                    <h3 className="text-sm font-semibold m-0">{t('mybots.savePatrol')}</h3>
                    <div className="flex flex-wrap gap-2">
                      <input
                        className="input input-bordered input-sm w-48"
                        placeholder="id"
                        value={patrolFormId}
                        onChange={(e) => setPatrolFormId(e.target.value)}
                      />
                      <input
                        className="input input-bordered input-sm w-64"
                        placeholder={t('mybots.patrolName')}
                        value={patrolFormName}
                        onChange={(e) => setPatrolFormName(e.target.value)}
                      />
                    </div>
                    <textarea
                      className="textarea textarea-bordered font-mono text-xs w-full min-h-28"
                      value={patrolFormWaypoints}
                      onChange={(e) => setPatrolFormWaypoints(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => {
                        let waypoints: unknown
                        try {
                          waypoints = JSON.parse(patrolFormWaypoints)
                        } catch {
                          toast.error(t('mybots.badWaypointJson'))
                          return
                        }
                        void api('/api/v1/mybots/patrols', {
                          method: 'POST',
                          body: JSON.stringify({
                            id: patrolFormId.trim(),
                            name: patrolFormName.trim() || patrolFormId.trim(),
                            waypoints,
                            accountId: 0,
                          }),
                        })
                          .then(() => {
                            toast.success(t('common.ok'))
                            return loadPatrols()
                          })
                          .catch((err) => toast.error(errorMessage(err, t)))
                      }}
                    >
                      {t('mybots.savePatrol')}
                    </button>
                  </section>
                )}
              </div>
            ),
          },
          {
            key: 'advanced',
            label: t('mybots.tabAdvanced'),
            children: (
              <div className="space-y-3 max-w-3xl">
                <PanelIntro>{t('mybots.advancedHint')}</PanelIntro>
                {!gm || !activeChar ? (
                  <p className="text-sm text-base-content/50 m-0">{t('mybots.loadFirst')}</p>
                ) : !botActive ? (
                  <p className="text-sm text-base-content/50 m-0">{t('mybots.needSelfbotHint')}</p>
                ) : (
                  <>
                    <label className="label cursor-pointer gap-2 justify-start">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={replaceJob}
                        onChange={(e) => setReplaceJob(e.target.checked)}
                      />
                      <span className="label-text text-xs">{t('mybots.replaceJob')}</span>
                    </label>
                    <Select
                      className="select-sm w-44"
                      value={jobType}
                      onChange={(v) => v && setJobType(v as JobType)}
                      options={[
                        { value: 'move_to', label: 'move_to' },
                        { value: 'complete_quest', label: 'complete_quest' },
                        { value: 'patrol', label: 'patrol' },
                        { value: 'script', label: 'script' },
                      ]}
                    />
                    {jobType === 'move_to' && (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={`btn btn-xs ${moveMode === 'xyz' ? 'btn-active' : ''}`}
                            onClick={() => setMoveMode('xyz')}
                          >
                            XYZ
                          </button>
                          <button
                            type="button"
                            className={`btn btn-xs ${moveMode === 'entry' ? 'btn-active' : ''}`}
                            onClick={() => setMoveMode('entry')}
                          >
                            entry
                          </button>
                        </div>
                        {moveMode === 'xyz' ? (
                          <div className="flex flex-wrap gap-2">
                            <input className="input input-bordered input-sm w-28" placeholder="x" value={moveX} onChange={(e) => setMoveX(e.target.value)} />
                            <input className="input input-bordered input-sm w-28" placeholder="y" value={moveY} onChange={(e) => setMoveY(e.target.value)} />
                            <input className="input input-bordered input-sm w-28" placeholder="z" value={moveZ} onChange={(e) => setMoveZ(e.target.value)} />
                            <input className="input input-bordered input-sm w-24" placeholder="dist" value={moveDist} onChange={(e) => setMoveDist(e.target.value)} />
                          </div>
                        ) : (
                          <input className="input input-bordered input-sm w-40" placeholder="entry" value={moveEntry} onChange={(e) => setMoveEntry(e.target.value)} />
                        )}
                      </div>
                    )}
                    {jobType === 'complete_quest' && (
                      <div className="flex flex-wrap gap-2">
                        <input className="input input-bordered input-sm w-32" placeholder="questId" value={questId} onChange={(e) => setQuestId(e.target.value)} />
                        <input className="input input-bordered input-sm w-32" placeholder="giverEntry" value={giverEntry} onChange={(e) => setGiverEntry(e.target.value)} />
                        <input className="input input-bordered input-sm w-32" placeholder="turninEntry" value={turninEntry} onChange={(e) => setTurninEntry(e.target.value)} />
                      </div>
                    )}
                    {jobType === 'patrol' && (
                      <input className="input input-bordered input-sm w-64" placeholder="patrolId" value={patrolId} onChange={(e) => setPatrolId(e.target.value)} />
                    )}
                    {jobType === 'script' && (
                      <textarea className="textarea textarea-bordered font-mono text-xs w-full min-h-32" value={scriptSteps} onChange={(e) => setScriptSteps(e.target.value)} />
                    )}
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => void createJob()}>
                      {t('mybots.submitJob')}
                    </button>
                  </>
                )}
              </div>
            ),
          },
        ]}
      />

      {pending && (
        <ConfirmDanger
          open
          title={pending.title}
          description={pending.description}
          onCancel={() => {
            setPending(null)
          }}
          onConfirm={() => {
            const run = pending.run
            setPending(null)
            void run()
              .then(() => toast.success(t('common.ok')))
              .catch((err) => toast.error(errorMessage(err, t)))
          }}
        />
      )}
    </div>
  )
}
