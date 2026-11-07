import { Link, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../auth/auth-context'

export function Layout() {
  const { user, loading, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    try {
      await logout()
    } finally {
      navigate('/')
    }
  }

  return (
    <>
      <header className="app-header">
        <Link to="/" className="brand">
          TinyVM
        </Link>
        <nav>
          {loading ? null : user ? (
            <>
              <span className="muted">{user.email}</span>
              <button type="button" className="secondary" onClick={handleLogout}>
                Выйти
              </button>
            </>
          ) : (
            <>
              <Link to="/login">Войти</Link>
              <Link to="/register">Регистрация</Link>
            </>
          )}
        </nav>
      </header>
      <main>{loading ? <p className="muted">Загрузка…</p> : <Outlet />}</main>
    </>
  )
}