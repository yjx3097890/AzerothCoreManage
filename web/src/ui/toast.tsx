import { useEffect, useState, type ReactNode } from 'react'

export type ToastKind = 'success' | 'error' | 'info'

type ToastItem = {
  id: number
  kind: ToastKind
  content: ReactNode
}

type Listener = (items: ToastItem[]) => void

let seq = 0
let items: ToastItem[] = []
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l(items)
}

function push(kind: ToastKind, content: ReactNode) {
  const id = ++seq
  items = [...items, { id, kind, content }]
  emit()
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id)
    emit()
  }, 3200)
}

export const toast = {
  success(content: ReactNode) {
    push('success', content)
  },
  error(content: ReactNode) {
    push('error', content)
  },
  info(content: ReactNode) {
    push('info', content)
  },
}

const alertClass: Record<ToastKind, string> = {
  success: 'alert-success',
  error: 'alert-error',
  info: 'alert-info',
}

export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>(items)

  useEffect(() => {
    listeners.add(setList)
    return () => {
      listeners.delete(setList)
    }
  }, [])

  if (list.length === 0) return null

  return (
    <div className="toast toast-top toast-end z-[100]">
      {list.map((t) => (
        <div key={t.id} className={`alert ${alertClass[t.kind]} shadow-lg`}>
          <span>{t.content}</span>
        </div>
      ))}
    </div>
  )
}
