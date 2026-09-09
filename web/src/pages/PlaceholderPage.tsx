import { Alert, Typography } from 'antd'
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
      <Typography.Title level={3}>{title}</Typography.Title>
      <Typography.Paragraph type="secondary">
        {t('placeholder.task', { task: taskId })}
        {note ? ` · ${note}` : null}
      </Typography.Paragraph>
      <Alert type="info" showIcon message={message} description={`GET ${endpoint}`} />
    </div>
  )
}
