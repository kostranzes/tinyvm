import { Link } from 'react-router'
import { useAuth } from '../auth/auth-context'

export function HomePage() {
  const { user } = useAuth()

  return (
    <>
      <h1>TinyVM</h1>
      {user ? (
        <p>
          Вы вошли как <strong>{user.email}</strong>. Здесь появится список задач.
        </p>
      ) : (
        <p>
          <Link to="/login">Войдите</Link> или <Link to="/register">зарегистрируйтесь</Link>,
          чтобы решать задачи.
        </p>
      )}
    </>
  )
}