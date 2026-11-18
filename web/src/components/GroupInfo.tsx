import { parseGroupBindingKey } from '../lib/groupRef'

/** Detail panel for an IdP group binding (mirrors UserInfo). */
export function GroupInfo({
  displayName,
  bindingKey,
}: {
  displayName?: string | null
  bindingKey: string
}) {
  const parsed = parseGroupBindingKey(bindingKey)
  const name = displayName?.trim() || parsed?.groupId || bindingKey

  return (
    <div className="group-info user-info" data-testid="group-info" role="dialog" aria-label="Group details">
      <dl className="user-info-list">
        <div className="user-info-row">
          <dt>Name</dt>
          <dd data-testid="group-info-name">{name}</dd>
        </div>
        {parsed?.groupId ? (
          <div className="user-info-row">
            <dt>Group ID</dt>
            <dd className="mono user-info-break" data-testid="group-info-id">
              {parsed.groupId}
            </dd>
          </div>
        ) : null}
        {parsed?.iss ? (
          <div className="user-info-row">
            <dt>Issuer</dt>
            <dd className="mono user-info-break" data-testid="group-info-iss">
              {parsed.iss}
            </dd>
          </div>
        ) : null}
        <div className="user-info-row">
          <dt>Binding</dt>
          <dd className="mono user-info-break" data-testid="group-info-binding">
            {bindingKey}
          </dd>
        </div>
      </dl>
    </div>
  )
}
