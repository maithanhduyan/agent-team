import { Link } from 'react-router-dom'

/**
 * Fallback for any unknown path. Gives the user a way back to the home page.
 */
export default function NotFoundPage() {
  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <h1 id="not-found-title">Page not found</h1>
      <p>The page you are looking for does not exist.</p>
      <Link to="/" className="btn">
        Back to home
      </Link>
    </section>
  )
}
