import { Trash2 as ActionTrash2, UserPlus as ActionUserPlus } from 'lucide-react'
import { useState } from 'react'
import { DirectoryPicker } from './DirectoryPicker'
import type {
  BasePermission,
  NamespaceRole,
} from '../lib/authzApi'

export const NAMESPACE_BASE_OPTS: BasePermission[] = [
  'none',
  'read',
  'triage',
  'write',
  'maintain',
  'admin',
]

export const NAMESPACE_BASE_HELP: Record<BasePermission, string> = {
  none: 'Members need an explicit repo role to see repositories.',
  read: 'Members can browse and pull every repository in the namespace.',
  triage: 'Members can manage issues/PRs but not push by default.',
  write: 'Members can push to repositories they can access.',
  maintain: 'Members can manage most repo settings without full admin.',
  admin: 'Members have admin on every repository (use sparingly).',
}

export type PendingNamespaceMember = {
  sub: string
  iss: string
  role: NamespaceRole
}

export type NamespaceCreateSettingsValue = {
  name: string
  basePermission: BasePermission
  membersCanCreateRepos: boolean
  members: PendingNamespaceMember[]
}

type Props = {
  value: NamespaceCreateSettingsValue
  onChange: (next: NamespaceCreateSettingsValue) => void
  disabled?: boolean
  showName?: boolean
  nameLabel?: string
}

export function NamespaceCreateSettings({
  value,
  onChange,
  disabled = false,
  showName = true,
  nameLabel = 'Name',
}: Props) {
  const [draftSub, setDraftSub] = useState('')
  const [draftIss, setDraftIss] = useState('mice-dev')
  const [draftRole, setDraftRole] = useState<NamespaceRole>('member')

  function addMember() {
    const sub = draftSub.trim()
    const iss = draftIss.trim()
    if (!sub || !iss) return
    const without = value.members.filter(
      (m) => !(m.sub === sub && m.iss === iss),
    )
    onChange({
      ...value,
      members: [...without, { sub, iss, role: draftRole }],
    })
    setDraftSub('')
  }

  return (
    <div className="ns-create-settings">
      {showName && (
        <label className="ns-settings-field">
          <span className="ns-settings-label">{nameLabel}</span>
          <input
            required
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder="my-team"
            autoComplete="off"
            pattern="[A-Za-z0-9._-]+"
            title="Letters, numbers, dots, underscores, hyphens"
            disabled={disabled}
          />
        </label>
      )}

      <label className="ns-settings-field">
        <span className="ns-settings-label">Base permission</span>
        <select
          value={value.basePermission}
          onChange={(e) =>
            onChange({
              ...value,
              basePermission: e.target.value as BasePermission,
            })
          }
          disabled={disabled}
        >
          {NAMESPACE_BASE_OPTS.map((o) => (
            <option key={o} value={o}>
              {o}
              {o === 'none' ? ' (recommended)' : ''}
            </option>
          ))}
        </select>
        <span className="muted small">
          {NAMESPACE_BASE_HELP[value.basePermission]}
        </span>
      </label>

      <label className="ns-settings-toggle">
        <input
          type="checkbox"
          checked={value.membersCanCreateRepos}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...value,
              membersCanCreateRepos: e.target.checked,
            })
          }
        />
        <span>
          <span className="ns-settings-label">
            Members can create repositories
          </span>
          <span className="muted small">
            When off, only namespace Owners can create repositories here.
            Instance admins manage the platform and have no data access.
          </span>
        </span>
      </label>

      <div className="ns-create-members">
        <h3 className="ns-settings-subhead">Members</h3>
        <p className="muted small">
          You become Owner automatically. Add other owners or members now
          (optional).
        </p>
        {value.members.length > 0 && (
          <ul className="ns-member-list">
            {value.members.map((m) => (
              <li key={`${m.iss}:${m.sub}`} className="ns-member-row">
                <div className="ns-member-main">
                  <code className="ns-member-sub">{m.sub}</code>
                  <span className="muted small">{m.iss}</span>
                </div>
                <span
                  className={
                    m.role === 'owner' ? 'ns-tag ns-tag-accent' : 'ns-tag'
                  }
                >
                  {m.role}
                </span>
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...value,
                      members: value.members.filter(
                        (x) => !(x.sub === m.sub && x.iss === m.iss),
                      ),
                    })
                  }
                >
                  <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="ns-member-form-fields">
          <DirectoryPicker
            kind="user"
            sub={draftSub}
            iss={draftIss}
            defaultIss="mice-dev"
            disabled={disabled}
            onChange={({ sub, iss }) => {
              setDraftSub(sub)
              setDraftIss(iss)
            }}
          />
          <label>
            Role
            <select
              value={draftRole}
              onChange={(e) =>
                setDraftRole(e.target.value as NamespaceRole)
              }
              disabled={disabled}
            >
              <option value="member">member</option>
              <option value="owner">owner</option>
            </select>
          </label>
          <div className="ns-member-form-actions">
            <button
              type="button"
              className="btn ghost"
              disabled={disabled || !draftSub.trim() || !draftIss.trim()}
              onClick={addMember}
            >
              <ActionUserPlus size={14} aria-hidden="true" className="button-label-icon" />Add member
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
