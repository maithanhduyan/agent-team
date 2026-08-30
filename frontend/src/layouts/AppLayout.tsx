import { Outlet } from 'react-router-dom'
import AppFooter from '../components/AppFooter'
import AppHeader from '../components/AppHeader'

/**
 * The app shell: a sticky header with the main navigation, a main content
 * region that renders the active route, and a footer.
 */
export default function AppLayout() {
  return (
    <div className="app-shell">
      <AppHeader />
      <main className="app-main">
        <Outlet />
      </main>
      <AppFooter />
    </div>
  )
}
