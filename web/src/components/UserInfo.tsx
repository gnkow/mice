/** Detail panel for a Principal / commit author. */
export function UserInfo({
  name,
  username,
  email,
  iss,
  sub,
  currentEmail,
}: {
  name?: string | null
  username?: string | null
  email?: string | null
  iss?: string | null
  sub?: string | null
  currentEmail?: string | null
}) {
  return (
    <div className="user-info" data-testid="user-info" role="dialog" aria-label="User details">
      <dl className="user-info-list">
        {name ? (
          <div className="user-info-row">
            <dt>Name</dt>
            <dd data-testid="user-info-name">{name}</dd>
          </div>
        ) : null}
        {username ? (
          <div className="user-info-row">
            <dt>Username</dt>
            <dd data-testid="user-info-username">{username}</dd>
          </div>
        ) : null}
        {email ? (
          <div className="user-info-row">
            <dt>Email</dt>
            <dd data-testid="commit-email" data-source="stored">
              <span className="mono">{email}</span>
              {currentEmail && currentEmail !== email ? (
                <span
                  className="muted small commit-email-current"
                  data-testid="commit-email-current"
                >
                  {' '}
                  (current: {currentEmail})
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
        {iss ? (
          <div className="user-info-row">
            <dt>Issuer</dt>
            <dd className="mono user-info-break" data-testid="user-info-iss">
              {iss}
            </dd>
          </div>
        ) : null}
        {sub ? (
          <div className="user-info-row">
            <dt>Subject</dt>
            <dd className="mono user-info-break" data-testid="user-info-sub">
              {sub}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  )
}
