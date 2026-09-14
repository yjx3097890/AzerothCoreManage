/** Helpers for GET /v1/characters/{id}/events (mod-mybots). Message holds all detail. */

export type PlanStep = { op?: string; detail?: unknown }

export type ParsedPlan = {
  count?: number
  steps: PlanStep[]
}

export type EventTone = 'ok' | 'warn' | 'error' | 'info' | 'llm' | 'nav' | 'job'

export type ParsedEventMessage = {
  summary: string
  pretty?: string
  steps?: PlanStep[]
  tone: EventTone
}

const PLAN_KINDS = new Set(['rules_plan', 'llm_decision'])

function tryParseJson(text: string): unknown | null {
  const s = text.trim()
  if (!s.startsWith('{') && !s.startsWith('[')) return null
  try {
    return JSON.parse(s) as unknown
  } catch {
    return null
  }
}

function asPlan(raw: unknown): ParsedPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const stepsRaw = obj.steps
  if (!Array.isArray(stepsRaw)) return null
  const steps = stepsRaw.map((s) => {
    if (!s || typeof s !== 'object') return {}
    const row = s as Record<string, unknown>
    return { op: typeof row.op === 'string' ? row.op : undefined, detail: row.detail }
  })
  const count = typeof obj.count === 'number' ? obj.count : steps.length
  return { count, steps }
}

function summarizeSteps(steps: PlanStep[]): string {
  if (steps.length === 0) return 'steps:0'
  const ops = steps.map((s) => s.op || '?')
  const head = ops.slice(0, 6).join(' → ')
  const more = ops.length > 6 ? ` …(+${ops.length - 6})` : ''
  return `steps:${ops.length} ${head}${more}`
}

function extractPlanSuffix(message: string): string | null {
  const marker = ';plan='
  const idx = message.indexOf(marker)
  if (idx < 0) return null
  return message.slice(idx + marker.length)
}

function toneForKind(kind: string): EventTone {
  if (kind.startsWith('nav')) return 'nav'
  if (
    kind.includes('failed') ||
    kind.includes('ignored') ||
    kind === 'job_failed' ||
    kind === 'llm_decision_failed'
  )
    return 'error'
  if (kind.includes('skipped') || kind.includes('fallback') || kind === 'job_cancelled') return 'warn'
  if (kind.includes('ok') || kind === 'job_succeeded' || kind === 'llm_decision') return 'ok'
  if (kind.startsWith('llm_') || kind === 'rules_plan') return 'llm'
  if (kind.startsWith('job_') || kind.startsWith('patrol_')) return 'job'
  return 'info'
}

/** Strip optional plan;/replan; prefix from llm_raw. */
export function stripLlmRawPrefix(message: string): { prefix?: string; body: string } {
  const m = message.match(/^(plan|replan);([\s\S]*)$/)
  if (m) return { prefix: m[1], body: m[2] }
  return { body: message }
}

export function parseEventMessage(kind: string, message?: string): ParsedEventMessage {
  const raw = message ?? ''
  const tone = toneForKind(kind)

  if (!raw) return { summary: '—', tone }

  if (PLAN_KINDS.has(kind)) {
    const parsed = asPlan(tryParseJson(raw))
    if (parsed) {
      return {
        summary: summarizeSteps(parsed.steps),
        pretty: JSON.stringify(parsed, null, 2),
        steps: parsed.steps,
        tone,
      }
    }
    return { summary: raw.slice(0, 120), pretty: raw, tone }
  }

  if (kind === 'llm_plan_ok' || kind === 'llm_replan_ok') {
    const planJson = extractPlanSuffix(raw)
    if (planJson) {
      const parsed = asPlan(tryParseJson(planJson))
      const meta = raw.slice(0, raw.indexOf(';plan='))
      if (parsed) {
        return {
          summary: `${meta} · ${summarizeSteps(parsed.steps)}`,
          pretty: JSON.stringify({ meta, plan: parsed }, null, 2),
          steps: parsed.steps,
          tone,
        }
      }
      return {
        summary: meta || raw.slice(0, 120),
        pretty: planJson,
        tone,
      }
    }
    return { summary: raw, tone }
  }

  if (kind === 'llm_raw') {
    const { prefix, body } = stripLlmRawPrefix(raw)
    const parsed = tryParseJson(body)
    return {
      summary: prefix ? `${prefix}; ${body.slice(0, 80)}${body.length > 80 ? '…' : ''}` : raw.slice(0, 100),
      pretty: parsed ? JSON.stringify(parsed, null, 2) : body,
      tone,
    }
  }

  if (kind === 'llm_decision_failed' || kind === 'llm_plan_ignored' || kind === 'llm_plan_failed') {
    const rawIdx = raw.indexOf(';raw=')
    if (rawIdx >= 0) {
      const head = raw.slice(0, rawIdx)
      const tail = raw.slice(rawIdx + 5)
      const parsed = tryParseJson(tail)
      return {
        summary: head || raw.slice(0, 120),
        pretty: parsed ? JSON.stringify(parsed, null, 2) : tail,
        tone,
      }
    }
  }

  const asJson = tryParseJson(raw)
  if (asJson != null) {
    const plan = asPlan(asJson)
    if (plan) {
      return {
        summary: summarizeSteps(plan.steps),
        pretty: JSON.stringify(asJson, null, 2),
        steps: plan.steps,
        tone,
      }
    }
    return {
      summary: raw.slice(0, 120),
      pretty: JSON.stringify(asJson, null, 2),
      tone,
    }
  }

  return { summary: raw.length > 160 ? `${raw.slice(0, 160)}…` : raw, pretty: raw.length > 80 ? raw : undefined, tone }
}

export function eventKindI18nKey(kind: string): string {
  return `mybots.eventKinds.${kind}`
}
