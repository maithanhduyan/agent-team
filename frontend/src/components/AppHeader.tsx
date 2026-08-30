import { NavLink } from 'react-router-dom'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'nav-link nav-link--active' : 'nav-link'

/**
 * Site header: brand + primary navigation (NavLink keeps the active route
 * highlighted and announced as current via aria-current).
 */
export default function AppHeader() {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <span className="app-brand" role="img" aria-label="agent-team">
          🧭
        </span>
        <span className="app-title">agent-team</span>
        <nav aria-label="Main navigation">
          <ul className="nav-list">
            <li>
              <NavLink to="/" end className={navLinkClass}>
                Home
              </NavLink>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  )
}
