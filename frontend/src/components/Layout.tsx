import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/auth-context'

export function Layout() {
  const { user, loading, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

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
          <span className="brand-name">TinyVM</span>
          <span className="brand-sub">x86-64 · NASM · отладчик</span>
        </Link>
        <nav>
          <Link to="/support">Поддержка</Link>
          {loading ? null : user ? (
            <>
              <Link to="/submissions">Мои отправки</Link>
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
      <main className={pathname.startsWith('/tasks/') ? 'wide' : undefined}>
        {loading ? <p className="muted">Загрузка…</p> : <Outlet />}
      </main>
    </>
  )
}