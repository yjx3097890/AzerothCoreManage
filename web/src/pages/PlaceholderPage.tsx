import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, type ApiError } from '../api/client'

type Props = {
  page: string
  task: string
  endpoint: string
}

export function PlaceholderPage({ page, task, endpoint }: Props) {
  const { t, i18n } = useTranslation()
  const [message, setMessage] = useState(t('common.loading'))
  const [taskId, setTaskId] = useState(task)
  const title = t(`pages.${page}.title`)
  const noteKey = `pages.${page}.note`
  const note = i18n.exists(noteKey) ? t(noteKey) : ''

  useEffect(() => {
    setMessage(t('common.loading'))
    api(endpoint)
      .then(() => setMessage(t('common.ready')))
      .catch((err: ApiError) => {
        setTaskId(err.task || task)
        setMessage(errorMessage(err, t))
      })
  }, [endpoint, task, t])

  return (
    <div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-base-content/60">
        {t('placeholder.task', { task: taskId })}
        {note ? ` · ${note}` : null}
      </p>
      <div className="alert alert-info">
        <div>
          <div className="font-medium">{message}</div>
          <div className="text-sm opacity-80">{`GET ${endpoint}`}</div>
        </div>
      </div>
    </div>
  )
}
