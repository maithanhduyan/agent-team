import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

/**
 * Render the full app shell (routes + layout) for a given starting URL.
 */
function renderAt(path: string) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  )
}

describe('App shell routing', () => {
  it('renders the shell (header, main, footer) on the home page', () => {
    renderAt('/')

    // Shell landmarks
    expect(
      screen.getByRole('banner').querySelector('.app-brand'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('navigation', { name: 'Main navigation' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()

    // Placeholder home content
    expect(
      screen.getByRole('heading', { name: 'Welcome to agent-team' }),
    ).toBeInTheDocument()
  })

  it('marks the Home nav link as the active route', () => {
    renderAt('/')

    const homeLink = screen.getByRole('link', { name: 'Home' })
    expect(homeLink).toHaveAttribute('aria-current', 'page')
  })

  it('renders the 404 page for an unknown path', () => {
    renderAt('/this-page-does-not-exist')

    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to home' }),
    ).toBeInTheDocument()
  })

  it('navigates from the 404 page back to the home page', async () => {
    const user = userEvent.setup()
    renderAt('/missing')

    await user.click(screen.getByRole('link', { name: 'Back to home' }))

    expect(
      screen.getByRole('heading', { name: 'Welcome to agent-team' }),
    ).toBeInTheDocument()
  })

  it('navigates to the home page via the header nav link', async () => {
    const user = userEvent.setup()
    renderAt('/missing')

    await user.click(screen.getByRole('link', { name: 'Home' }))

    expect(
      screen.getByRole('heading', { name: 'Welcome to agent-team' }),
    ).toBeInTheDocument()
  })
})
