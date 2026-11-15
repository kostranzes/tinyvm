import { BrowserRouter, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { Layout } from './components/Layout'
import { AuthPage } from './pages/AuthPage'
import { HomePage } from './pages/HomePage'
import { TaskPage } from './pages/TaskPage'
import { SubmissionPage } from './pages/SubmissionPage'
import { SubmissionsPage } from './pages/SubmissionsPage'
import { SupportPage } from './pages/SupportPage'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="tasks/:slug" element={<TaskPage />} />
            <Route path="submissions" element={<SubmissionsPage />} />
            <Route path="submissions/:id" element={<SubmissionPage />} />
            <Route path="support" element={<SupportPage />} />
            <Route path="login" element={<AuthPage mode="login" />} />
            <Route path="register" element={<AuthPage mode="register" />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App