import { Button, Card, Form, Input, Typography, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, errorMessage, setSession } from '../api/client'
import { LanguageSwitch } from '../i18n/LanguageSwitch'

export function LoginPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f5f5f5' }}>
      <Card
        style={{ width: 360 }}
        extra={<LanguageSwitch />}
        title={t('login.title')}
      >
        <Typography.Paragraph type="secondary">{t('login.hint')}</Typography.Paragraph>
        <Form
          layout="vertical"
          onFinish={async (values: { username: string; password: string }) => {
            try {
              const data = await api<{ token: string; user: { username: string; role: 'readonly' | 'gm' | 'superadmin' } }>(
                '/api/v1/auth/login',
                {
                  method: 'POST',
                  body: JSON.stringify(values),
                },
              )
              setSession(data.user, data.token)
              navigate('/')
            } catch (err) {
              message.error(errorMessage(err, t))
            }
          }}
        >
          <Form.Item name="username" label={t('login.username')} rules={[{ required: true, message: t('validation.required') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label={t('login.password')} rules={[{ required: true, message: t('validation.required') }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            {t('common.login')}
          </Button>
        </Form>
      </Card>
    </div>
  )
}
