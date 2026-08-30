import { Route, Routes } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import HomePage from './pages/HomePage'
import NotFoundPage from './pages/NotFoundPage'

/**
 * App shell routes.
 *
 * Every route renders inside the shared shell layout (header + main + footer);
 * the placeholder home page is served at `/` and any unknown path falls back
 * to the 404 page.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
