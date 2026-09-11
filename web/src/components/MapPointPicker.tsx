import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type MapPoint = {
  id: string
  label: string
  x: number
  y: number
  z: number
  map: number
}

export type MapPick = {
  x: number
  y: number
  z: number
  label?: string
  source: 'tile' | 'overview' | 'tele'
}

type Manifest = {
  mapId: number
  name?: string
  mode: 'minimap' | 'overview'
  tileSize?: number
  tileScale?: number
  overview?: {
    image: string
    minX: number
    maxX: number
    minY: number
    maxY: number
  }
  minimap?: {
    tilePath: string
    iMin?: number
    iMax?: number
    jMin?: number
    jMax?: number
  }
}

type WorldMapEntry = {
  folder: string
  mapId: number
  areaId?: number
  image: string
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type WorldMapIndex = {
  byAreaId?: Record<string, WorldMapEntry>
  byMapId?: Record<string, WorldMapEntry>
}

type OverviewLayer = {
  kind: 'zone' | 'continent' | 'manifest'
  name: string
  imageUrl: string
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type Props = {
  mapId: number
  zoneId?: number | null
  player?: { x: number; y: number; z: number } | null
  points: MapPoint[]
  onPick: (pick: MapPick) => void
  disabled?: boolean
  className?: string
}

const DEFAULT_TILE_SCALE = 533.333333333
const DEFAULT_TILE_SIZE = 256

function worldToTile(x: number, y: number, scale: number) {
  const i = 32 - Math.ceil(y / scale)
  const j = 32 - Math.ceil(x / scale)
  return { i, j }
}

function tilePixelToWorld(
  i: number,
  j: number,
  localX: number,
  localY: number,
  tileSize: number,
  scale: number,
) {
  const fracJ = localX / tileSize
  const fracI = localY / tileSize
  const x = (32 - j - fracJ) * scale
  const y = (32 - i - fracI) * scale
  return { x, y }
}

async function loadManifest(mapId: number): Promise<Manifest | null> {
  try {
    const res = await fetch(`/maps/${mapId}/manifest.json`, { cache: 'no-cache' })
    if (!res.ok) return null
    const data = (await res.json()) as Manifest
    if (!data || (data.mode !== 'minimap' && data.mode !== 'overview')) return null
    return data
  } catch {
    return null
  }
}

async function loadWorldMapIndex(): Promise<WorldMapIndex | null> {
  try {
    const res = await fetch('/maps/worldmap/index.json', { cache: 'no-cache' })
    if (!res.ok) return null
    return (await res.json()) as WorldMapIndex
  } catch {
    return null
  }
}

function entryToLayer(entry: WorldMapEntry, kind: 'zone' | 'continent'): OverviewLayer {
  return {
    kind,
    name: entry.folder,
    imageUrl: `/maps/worldmap/${entry.image}`,
    minX: entry.minX,
    maxX: entry.maxX,
    minY: entry.minY,
    maxY: entry.maxY,
  }
}

export function MapPointPicker({ mapId, zoneId, player, points, onPick, disabled, className }: Props) {
  const { t } = useTranslation()
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [worldLayer, setWorldLayer] = useState<OverviewLayer | null>(null)
  const [checked, setChecked] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setChecked(false)
    setManifest(null)
    setWorldLayer(null)

    void (async () => {
      const [wm, man] = await Promise.all([loadWorldMapIndex(), loadManifest(mapId)])
      if (cancelled) return

      let layer: OverviewLayer | null = null
      if (wm) {
        if (zoneId != null && wm.byAreaId?.[String(zoneId)]) {
          layer = entryToLayer(wm.byAreaId[String(zoneId)], 'zone')
        } else if (wm.byMapId?.[String(mapId)]) {
          layer = entryToLayer(wm.byMapId[String(mapId)], 'continent')
        }
      }
      if (!layer && man?.mode === 'overview' && man.overview) {
        layer = {
          kind: 'manifest',
          name: man.name || String(mapId),
          imageUrl: `/maps/${mapId}/${man.overview.image}`,
          minX: man.overview.minX,
          maxX: man.overview.maxX,
          minY: man.overview.minY,
          maxY: man.overview.maxY,
        }
      }

      setWorldLayer(layer)
      // Prefer WorldMap; keep minimap manifest only as fallback when no world layer.
      setManifest(layer ? null : man)
      setChecked(true)
    })()

    return () => {
      cancelled = true
    }
  }, [mapId, zoneId])

  const mode = !checked
    ? 'loading'
    : worldLayer
      ? 'overview'
      : manifest?.mode === 'minimap'
        ? 'minimap'
        : 'scatter'

  const scatter = useMemo(() => {
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    if (player) {
      xs.push(player.x)
      ys.push(player.y)
    }
    if (!xs.length) {
      return { minX: -100, maxX: 100, minY: -100, maxY: 100 }
    }
    const pad = 80
    let minX = Math.min(...xs) - pad
    let maxX = Math.max(...xs) + pad
    let minY = Math.min(...ys) - pad
    let maxY = Math.max(...ys) + pad
    if (maxX - minX < 200) {
      const mid = (maxX + minX) / 2
      minX = mid - 100
      maxX = mid + 100
    }
    if (maxY - minY < 200) {
      const mid = (maxY + minY) / 2
      minY = mid - 100
      maxY = mid + 100
    }
    return { minX, maxX, minY, maxY }
  }, [points, player])

  const projectScatter = useCallback(
    (x: number, y: number, w: number, h: number) => {
      const { minX, maxX, minY, maxY } = scatter
      const px = ((x - minX) / (maxX - minX)) * w
      const py = (1 - (y - minY) / (maxY - minY)) * h
      return { px, py }
    },
    [scatter],
  )

  const handleOverviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled || !worldLayer) return
    const rect = e.currentTarget.getBoundingClientRect()
    const u = (e.clientX - rect.left) / rect.width
    const v = (e.clientY - rect.top) / rect.height
    const { minX, maxX, minY, maxY } = worldLayer
    const x = minX + u * (maxX - minX)
    const y = maxY - v * (maxY - minY)
    onPick({
      x,
      y,
      z: player?.z ?? 0,
      source: 'overview',
      label: t('mybots.mapPickOverview'),
    })
  }

  const tileScale = manifest?.tileScale ?? DEFAULT_TILE_SCALE
  const tileSize = manifest?.tileSize ?? DEFAULT_TILE_SIZE
  const center = player ?? (points[0] ? { x: points[0].x, y: points[0].y, z: points[0].z } : { x: 0, y: 0, z: 0 })
  const centerTile = worldToTile(center.x, center.y, tileScale)
  const radius = 2

  const tiles = useMemo(() => {
    if (manifest?.mode !== 'minimap' || !manifest.minimap) return []
    const pathTpl = manifest.minimap.tilePath || 'tiles/map{i}_{j}.png'
    const iMin = manifest.minimap.iMin ?? 0
    const iMax = manifest.minimap.iMax ?? 63
    const jMin = manifest.minimap.jMin ?? 0
    const jMax = manifest.minimap.jMax ?? 63
    const out: { i: number; j: number; url: string }[] = []
    for (let i = centerTile.i - radius; i <= centerTile.i + radius; i++) {
      for (let j = centerTile.j - radius; j <= centerTile.j + radius; j++) {
        if (i < iMin || i > iMax || j < jMin || j > jMax) continue
        const url = `/maps/${mapId}/${pathTpl.replace('{i}', String(i)).replace('{j}', String(j))}`
        out.push({ i, j, url })
      }
    }
    return out
  }, [manifest, mapId, centerTile.i, centerTile.j])

  const gridSize = (radius * 2 + 1) * tileSize

  const handleMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return
    const rect = e.currentTarget.getBoundingClientRect()
    const localX = ((e.clientX - rect.left) / rect.width) * gridSize
    const localY = ((e.clientY - rect.top) / rect.height) * gridSize
    const originI = centerTile.i - radius
    const originJ = centerTile.j - radius
    const j = originJ + Math.floor(localX / tileSize)
    const i = originI + Math.floor(localY / tileSize)
    const lx = localX - (j - originJ) * tileSize
    const ly = localY - (i - originI) * tileSize
    const { x, y } = tilePixelToWorld(i, j, lx, ly, tileSize, tileScale)
    onPick({
      x,
      y,
      z: player?.z ?? 0,
      source: 'tile',
      label: t('mybots.mapPickTile', { i, j }),
    })
  }

  const playerMarker = useMemo(() => {
    if (!player || mode !== 'minimap') return null
    const originI = centerTile.i - radius
    const originJ = centerTile.j - radius
    const jFloat = 32 - player.x / tileScale
    const iFloat = 32 - player.y / tileScale
    const px = (jFloat - originJ) * tileSize
    const py = (iFloat - originI) * tileSize
    return { px, py }
  }, [player, mode, centerTile.i, centerTile.j, tileScale, tileSize])

  const modeLabel = (() => {
    if (mode === 'loading') return t('mybots.mapLoading')
    if (mode === 'scatter') return t('mybots.mapModeScatter')
    if (mode === 'minimap') return t('mybots.mapModeTiles', { name: manifest?.name || mapId })
    if (worldLayer?.kind === 'zone') return t('mybots.mapModeZone', { name: worldLayer.name })
    if (worldLayer?.kind === 'continent') return t('mybots.mapModeContinent', { name: worldLayer.name })
    return t('mybots.mapModeOverview', { name: worldLayer?.name || mapId })
  })()

  return (
    <div className={`${className ?? ''} ${disabled ? 'opacity-50' : ''}`.trim()} aria-disabled={disabled || undefined}>
      <div className="text-xs text-base-content/55 mb-2">{modeLabel}</div>

      <div className={disabled ? 'pointer-events-none select-none' : undefined}>
      {mode === 'scatter' && (
        <div
          ref={wrapRef}
          className="relative w-full h-[360px] rounded-lg border border-base-300 bg-base-200 overflow-hidden"
        >
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 800 360" preserveAspectRatio="none">
            {points.map((p) => {
              const { px, py } = projectScatter(p.x, p.y, 800, 360)
              return (
                <g key={p.id}>
                  <circle
                    cx={px}
                    cy={py}
                    r={hover === p.id ? 8 : 6}
                    className="fill-primary cursor-pointer"
                    onMouseEnter={() => setHover(p.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() =>
                      onPick({ x: p.x, y: p.y, z: p.z, label: p.label, source: 'tele' })
                    }
                  />
                  {(hover === p.id || points.length <= 24) && (
                    <text x={px + 10} y={py + 4} className="fill-base-content text-[10px]">
                      {p.label}
                    </text>
                  )}
                </g>
              )
            })}
            {player && (() => {
              const { px, py } = projectScatter(player.x, player.y, 800, 360)
              return (
                <g>
                  <circle cx={px} cy={py} r={9} className="fill-success stroke-base-100" strokeWidth={2} />
                  <text x={px + 12} y={py + 4} className="fill-success text-[11px] font-semibold">
                    {t('mybots.youAreHere')}
                  </text>
                </g>
              )
            })()}
          </svg>
          {!points.length && !player && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-base-content/50">
              {t('mybots.mapNoPoints')}
            </div>
          )}
        </div>
      )}

      {mode === 'overview' && worldLayer && (
        <div
          className="relative w-full max-w-[720px] mx-auto rounded-lg border border-base-300 overflow-hidden bg-neutral cursor-crosshair"
          style={{ aspectRatio: '4 / 3' }}
          onClick={handleOverviewClick}
        >
          <img
            src={worldLayer.imageUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-fill"
            draggable={false}
          />
          {player && (
            <div
              className="absolute w-3 h-3 rounded-full bg-success border-2 border-base-100 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10"
              style={{
                left: `${((player.x - worldLayer.minX) / (worldLayer.maxX - worldLayer.minX)) * 100}%`,
                top: `${(1 - (player.y - worldLayer.minY) / (worldLayer.maxY - worldLayer.minY)) * 100}%`,
              }}
              title={t('mybots.youAreHere')}
            />
          )}
          {points.map((p) => {
            const left = ((p.x - worldLayer.minX) / (worldLayer.maxX - worldLayer.minX)) * 100
            const top = (1 - (p.y - worldLayer.minY) / (worldLayer.maxY - worldLayer.minY)) * 100
            if (left < 0 || left > 100 || top < 0 || top > 100) return null
            return (
              <button
                key={p.id}
                type="button"
                className="absolute w-2.5 h-2.5 rounded-full bg-primary border border-base-100 -translate-x-1/2 -translate-y-1/2 z-10"
                style={{ left: `${left}%`, top: `${top}%` }}
                title={p.label}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onPick({ x: p.x, y: p.y, z: p.z, label: p.label, source: 'tele' })
                }}
              />
            )
          })}
        </div>
      )}

      {mode === 'minimap' && (
        <div
          className="relative rounded-lg border border-base-300 overflow-hidden bg-neutral cursor-crosshair mx-auto"
          style={{ width: 'min(100%, 520px)', aspectRatio: '1 / 1' }}
          onClick={handleMinimapClick}
        >
          <div
            className="absolute inset-0 grid"
            style={{
              gridTemplateColumns: `repeat(${radius * 2 + 1}, 1fr)`,
              gridTemplateRows: `repeat(${radius * 2 + 1}, 1fr)`,
            }}
          >
            {tiles.map((tile) => (
              <img
                key={`${tile.i}_${tile.j}`}
                src={tile.url}
                alt=""
                className="w-full h-full object-cover bg-neutral-content/10"
                draggable={false}
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.opacity = '0.15'
                }}
              />
            ))}
          </div>
          {playerMarker && (
            <div
              className="absolute w-3 h-3 rounded-full bg-success border-2 border-base-100 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10"
              style={{
                left: `${(playerMarker.px / gridSize) * 100}%`,
                top: `${(playerMarker.py / gridSize) * 100}%`,
              }}
            />
          )}
          {points.map((p) => {
            const originI = centerTile.i - radius
            const originJ = centerTile.j - radius
            const jFloat = 32 - p.x / tileScale
            const iFloat = 32 - p.y / tileScale
            const left = (((jFloat - originJ) * tileSize) / gridSize) * 100
            const top = (((iFloat - originI) * tileSize) / gridSize) * 100
            if (left < 0 || left > 100 || top < 0 || top > 100) return null
            return (
              <button
                key={p.id}
                type="button"
                className="absolute w-2.5 h-2.5 rounded-full bg-primary border border-base-100 -translate-x-1/2 -translate-y-1/2 z-10"
                style={{ left: `${left}%`, top: `${top}%` }}
                title={p.label}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onPick({ x: p.x, y: p.y, z: p.z, label: p.label, source: 'tele' })
                }}
              />
            )
          })}
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}
      </div>
    </div>
  )
}
