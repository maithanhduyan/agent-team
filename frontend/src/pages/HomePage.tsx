/**
 * Placeholder home page. Served at `/` by the app shell routes — replace the
 * placeholder copy with the real product landing page in a follow-up task.
 */
export default function HomePage() {
  return (
    <section className="home-page" aria-labelledby="home-title">
      <h1 id="home-title">Welcome to agent-team</h1>
      <p className="home-tagline">
        The frontend app shell is up and running — routing is wired and this
        is the placeholder home page.
      </p>
      <p className="home-hint">
        Next up: real pages for this product, integrated with the orchestrator
        API.
      </p>
    </section>
  )
}
