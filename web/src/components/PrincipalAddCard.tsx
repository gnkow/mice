import { Plus as ActionPlus } from 'lucide-react'
import { useState } from 'react'
import { DirectoryPicker } from './DirectoryPicker'

export type PrincipalAddUser = {
  kind: 'user'
  sub: string
  iss: string
  /** IdP display name from directory search, when known. */
  name?: string
  email?: string
}
export type PrincipalAddGroup = { kind: 'group'; group: string; name: string }
export type PrincipalAddValue = PrincipalAddUser | PrincipalAddGroup

export type PrincipalRoleOption = { value: string; label: string }
export type PrincipalRoleGroup = {
  label?: string
  options: PrincipalRoleOption[]
}

type Props = {
  disabled?: boolean
  /**
   * Role select value (controlled by parent). Omit both `role` and `roles` to hide
   * the role control (approver seats have a fixed grant).
   */
  role?: string
  onRoleChange?: (role: string) => void
  /** Flat options, or grouped (custom roles). */
  roles?: PrincipalRoleOption[] | PrincipalRoleGroup[]
  addLabel?: string
  /** Called when Add is pressed with a selected directory principal. */
  onAdd: (principal: PrincipalAddValue) => void | Promise<void>
}

function isGrouped(
  roles: PrincipalRoleOption[] | PrincipalRoleGroup[],
): roles is PrincipalRoleGroup[] {
  return roles.length > 0 && 'options' in roles[0]!
}

/**
 * Shared User/Group directory picker + optional role + Add — used on New repository,
 * namespace Members, repository Collaborators, and Approvers.
 */
export function PrincipalAddCard({
  disabled,
  role,
  onRoleChange,
  roles,
  addLabel = 'Add',
  onAdd,
}: Props) {
  const [kind, setKind] = useState<'user' | 'group'>('user')
  const [sub, setSub] = useState('')
  const [iss, setIss] = useState('mice-dev')
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [group, setGroup] = useState('')
  const [groupName, setGroupName] = useState('')
  const [busy, setBusy] = useState(false)

  const showRole = Boolean(roles && roles.length > 0 && role != null && onRoleChange)

  const canAdd =
    kind === 'group'
      ? Boolean(group.trim())
      : Boolean(sub.trim() && iss.trim())

  async function handleAdd() {
    if (disabled || busy || !canAdd) return
    setBusy(true)
    try {
      if (kind === 'group') {
        const g = group.trim()
        await onAdd({
          kind: 'group',
          group: g,
          name: groupName.trim() || g,
        })
        setGroup('')
        setGroupName('')
      } else {
        const name = userName.trim()
        const email = userEmail.trim()
        await onAdd({
          kind: 'user',
          sub: sub.trim(),
          iss: iss.trim(),
          ...(name ? { name } : {}),
          ...(email ? { email } : {}),
        })
        setSub('')
        setIss('mice-dev')
        setUserName('')
        setUserEmail('')
      }
    } catch {
      // Parent surfaces the error; keep the selection so the user can retry.
    } finally {
      setBusy(false)
    }
  }

  const blocked = Boolean(disabled || busy)

  return (
    <div className="principal-add-card new-repo-add-card">
      <div className="principal-add-kind new-repo-add-kind" role="group" aria-label="Principal type">
        <button
          type="button"
          className={
            kind === 'user'
              ? 'btn small new-repo-kind-btn is-active'
              : 'btn ghost small new-repo-kind-btn'
          }
          disabled={blocked}
          onClick={() => setKind('user')}
        >
          User
        </button>
        <button
          type="button"
          className={
            kind === 'group'
              ? 'btn small new-repo-kind-btn is-active'
              : 'btn ghost small new-repo-kind-btn'
          }
          disabled={blocked}
          onClick={() => setKind('group')}
        >
          Group
        </button>
      </div>
      {kind === 'group' ? (
        <DirectoryPicker
          kind="group"
          group={group}
          label={groupName}
          disabled={blocked}
          onChange={({ group: g, name }) => {
            setGroup(g)
            setGroupName(name)
          }}
        />
      ) : (
        <DirectoryPicker
          kind="user"
          sub={sub}
          iss={iss}
          defaultIss="mice-dev"
          disabled={blocked}
          onChange={({ sub: s, iss: i, name, email }) => {
            setSub(s)
            setIss(i)
            setUserName(name?.trim() ?? '')
            setUserEmail(email?.trim() ?? '')
          }}
        />
      )}
      <div className="principal-add-actions new-repo-add-actions">
        <button
          type="button"
          className="btn primary"
          disabled={blocked || !canAdd}
          onClick={() => void handleAdd()}
        >
          <ActionPlus size={14} aria-hidden="true" className="button-label-icon" />
          {addLabel}
        </button>
        {showRole ? (
          <>
            <span className="new-repo-add-as" aria-hidden="true">
              as
            </span>
            <label className="new-repo-add-role">
              <span className="visually-hidden">Role</span>
              <select
                value={role}
                onChange={(e) => onRoleChange!(e.target.value)}
                disabled={blocked}
                aria-label="Role"
              >
                {isGrouped(roles!)
                  ? roles!.map((g, i) =>
                      g.label ? (
                        <optgroup key={`${g.label}-${i}`} label={g.label}>
                          {g.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : (
                        g.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))
                      ),
                    )
                  : roles!.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
              </select>
            </label>
          </>
        ) : null}
      </div>
    </div>
  )
}
