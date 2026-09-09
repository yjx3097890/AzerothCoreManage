import { Navigate, Outlet } from 'react-router-dom'
import { getToken } from '../api/client'
import { AdminLayout } from '../layout/AdminLayout'

export function RequireAuth() {
  if (!getToken()) {
    return <Navigate to="/login" replace />
  }
  return (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  )
}
