import {
  AlignLeft as ActionAlignLeft,
  FileSignature as ActionFileSignature,
  History as ActionHistory,
  MoveRight as ActionMoveRight,
  Pencil as ActionPencil,
  Settings as ActionSettings,
  ShieldAlert as ActionShieldAlert,
  ShieldCheck as ActionShieldCheck,
  Tags as ActionTags,
  Users as ActionUsers,
} from 'lucide-react'
import { NavLink, Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import {
  fetchRepoPermissions,
  type RepoViewerPermissions,
} from '../lib/authzApi'
import { SectionNav, type SectionNavGroup } from './SectionNav'

type NavItem = SectionNavGroup['items'][number] & {
  requires?: keyof RepoViewerPermissions
}

const SETTINGS_NAV_ITEMS: NavItem[] = [
  { id: 'repo-about', label: 'About', Icon: ActionAlignLeft, requires: 'rename' },
  { id: 'repo-rename', label: 'Rename', Icon: ActionPencil, requires: 'rename' },
  { id: 'repo-transfer', label: 'Transfer', Icon: ActionMoveRight, requires: 'transfer' },
  // Always listed: seats are visible read-only when the caller cannot change them.
  { id: 'repo-collaborators', label: 'Collaborators', Icon: ActionUsers },
  { id: 'repo-approvers', label: 'Approvers', Icon: ActionShieldCheck },
  { id: 'repo-validated-branches', label: 'Validated branches', Icon: ActionShieldCheck },
  {
    id: 'repo-signatures',
    label: 'Signatures',
    Icon: ActionFileSignature,
    requires: 'viewSignedRecord',
  },
  { id: 'repo-metadata', label: 'Metadata', Icon: ActionTags, requires: 'viewSignedRecord' },
  {
    id: 'repo-danger',
    label: 'Danger zone',
    Icon: ActionShieldAlert,
    requires: 'deleteRepository',
  },
]

function settingsNavGroups(perms: RepoViewerPermissions | null): SectionNavGroup[] {
  const items = SETTINGS_NAV_ITEMS.filter(
    (item) => !item.requires || (perms?.[item.requires] ?? false),
  ).map(({ id, label, Icon }) => ({ id, label, Icon }))
  return [{ title: 'Settings', Icon: ActionSettings, items }]
}

export type RepoSettingsOutletContext = {
  permissions: RepoViewerPermissions
}

/** Left section nav + outlet for `/n/:ns/r/:repo/settings/*`. */
export function RepoSettingsLayout() {
  const { namespace = '', repo = '' } = useParams()
  const location = useLocation()
  const parentCtx = useOutletContext()
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/settings`
  const onHistory = /\/settings\/(?:history|collaborators\/history|approvers\/history)\/?$/.test(
    location.pathname,
  )
  const authz = useAsync(
    (signal) => fetchRepoPermissions(namespace, repo, signal),
    [namespace, repo],
  )
  const perms = authz.kind === 'ok' ? authz.data : null
  const navGroups = settingsNavGroups(perms)
  const historyLinks = [
    ...(perms?.rename || perms?.transfer || perms?.deleteRepository
      ? [{ path: 'history', label: 'Settings history' }]
      : []),
    ...(perms?.manageCollaborators
      ? [{ path: 'collaborators/history', label: 'Collaborator history' }]
      : []),
    ...(perms?.manageApprovers
      ? [{ path: 'approvers/history', label: 'Approver history' }]
      : []),
  ]

  return (
    <div className="profile-layout ns-settings-layout">
      <aside className="ns-settings-aside" aria-label="Settings sections">
        <nav className="profile-nav ns-settings-nav" aria-label="Settings sections">
          {onHistory ? (
            <div className="profile-nav-group">
              <p className="profile-nav-title" id="repo-settings-nav-title">
                <ActionSettings size={14} aria-hidden="true" />
                Settings
              </p>
              <ul aria-labelledby="repo-settings-nav-title">
                {navGroups[0]?.items.map(({ id, label, Icon }) => (
                  <li key={id}>
                    <NavLink to={`${base}#${id}`}>
                      <Icon size={16} aria-hidden="true" />
                      {label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <SectionNav label="Settings sections" groups={navGroups} bare />
          )}
          {historyLinks.length > 0 ? (
            <div className="profile-nav-group">
              <p className="profile-nav-title" id="repo-settings-history-title">
                <ActionHistory size={14} aria-hidden="true" />
                History
              </p>
              <ul aria-labelledby="repo-settings-history-title">
                {historyLinks.map(({ path, label }) => (
                  <li key={path}>
                    <NavLink to={`${base}/${path}`}>
                      <ActionHistory size={16} aria-hidden="true" />
                      {label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </nav>
      </aside>
      <div className="profile-main ns-settings-main">
        <Outlet
          context={
            {
              ...((parentCtx && typeof parentCtx === 'object' ? parentCtx : {}) as object),
              permissions: perms ?? {
                rename: false,
                transfer: false,
                manageCollaborators: false,
                manageApprovers: false,
                editMetadata: false,
                deleteRepository: false,
                viewSignedRecord: false,
                contentsWrite: false,
                isApprover: false,
              },
            } satisfies RepoSettingsOutletContext
          }
        />
      </div>
    </div>
  )
}
