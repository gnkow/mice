export function DocsPage() {
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Docs</h1>
          <p className="lede">
            Documentation and guides for using the platform.
          </p>
        </div>
      </div>

      <ul className="card-list">
        <li>
          <a
            className="repo-summary-card"
            href="https://docs.oxen.ai/"
            rel="noreferrer"
            target="_blank"
          >
            <span className="repo-summary-main">
              <span className="card-title">Oxen docs</span>
              <span className="card-meta">
                Getting started, CLI, Python, and Hub guides
              </span>
            </span>
          </a>
        </li>
        <li>
          <a
            className="repo-summary-card"
            href="https://docs.oxen.ai/getting-started/oxen-server"
            rel="noreferrer"
            target="_blank"
          >
            <span className="repo-summary-main">
              <span className="card-title">oxen-server</span>
              <span className="card-meta">
                Install, configure, and run a self-hosted server
              </span>
            </span>
          </a>
        </li>
        <li>
          <a
            className="repo-summary-card"
            href="https://docs.oxen.ai/api-reference"
            rel="noreferrer"
            target="_blank"
          >
            <span className="repo-summary-main">
              <span className="card-title">API reference</span>
              <span className="card-meta">HTTP API used by Mice</span>
            </span>
          </a>
        </li>
      </ul>
    </main>
  )
}
