import {
  History as ActionHistory,
  Inbox as ActionInbox,
  Pencil as ActionPencil,
  Settings as ActionSettings,
  ShieldCheck as ActionShieldCheck,
  ShieldAlert as ActionShieldAlert,
  Tags as ActionTags,
  Users as ActionUsers,
  Wrench as ActionWrench,
} from 'lucide-react'
import { NavLink, Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import {
  fetchNamespaceAuthz,
  type NamespaceViewerPermissions,
} from '../lib/authzApi'
import { SectionNav, type SectionNavGroup } from './SectionNav'

type NavItem = SectionNavGroup['items'][number] & {
  /** When set, item is shown only when that permission is true. */
  requires?: keyof NamespaceViewerPermissions
}

const SETTINGS_NAV_ITEMS: NavItem[] = [
  { id: 'ns-general', label: 'General', Icon: ActionSettings },
  { id: 'ns-rename', label: 'Rename', Icon: ActionPencil, requires: 'manageSettings' },
  { id: 'ns-members', label: 'Members', Icon: ActionUsers },
  { id: 'ns-approvers', label: 'Approvers', Icon: ActionShieldCheck },
  {
    id: 'ns-incoming-transfers',
    label: 'Incoming transfers',
    Icon: ActionInbox,
    requires: 'manageSettings',
  },
  { id: 'ns-custom-roles', label: 'Custom roles', Icon: ActionWrench, requires: 'manageCustomRoles' },
  { id: 'ns-metadata', label: 'Metadata', Icon: ActionTags },
  { id: 'ns-danger', label: 'Danger zone', Icon: ActionShieldAlert, requires: 'deleteNamespace' },
]

const HISTORY_LINKS: Array<{
  path: string
  label: string
  requires?: keyof NamespaceViewerPermissions
}> = [
  { path: 'history', label: 'Settings history', requires: 'manageSettings' },
  { path: 'members/history', label: 'Membership history', requires: 'manageMembers' },
  { path: 'approvers/history', label: 'Approver history', requires: 'manageApprovers' },
  { path: 'custom-roles/history', label: 'Custom roles history', requires: 'manageCustomRoles' },
]

function settingsNavGroups(perms: NamespaceViewerPermissions | null): SectionNavGroup[] {
  const items = SETTINGS_NAV_ITEMS.filter(
    (item) => !item.requires || (perms?.[item.requires] ?? false),
  ).map(({ id, label, Icon }) => ({ id, label, Icon }))
  return [{ title: 'Settings', Icon: ActionSettings, items }]
}

/** Left section nav + outlet for `/n/:namespace/settings/*`. */
export function NamespaceSettingsLayout() {
  const { namespace = '' } = useParams()
  const location = useLocation()
  const parentCtx = useOutletContext()
  const base = `/n/${encodeURIComponent(namespace)}/settings`
  const onHistory =
    /\/settings\/(?:history|members\/history|approvers\/history|custom-roles\/history)\/?$/.test(
      location.pathname,
    )
  const authz = useAsync((signal) => fetchNamespaceAuthz(namespace, signal), [namespace])
  const perms = authz.kind === 'ok' ? authz.data.permissions : null
  const navGroups = settingsNavGroups(perms)
  const historyLinks = HISTORY_LINKS.filter(
    (link) => !link.requires || (perms?.[link.requires] ?? false),
  )

  return (
    <div className="profile-layout ns-settings-layout">
      <aside className="ns-settings-aside" aria-label="Settings sections">
        <nav className="profile-nav ns-settings-nav" aria-label="Settings sections">
          {onHistory ? (
            <div className="profile-nav-group">
              <p className="profile-nav-title" id="ns-settings-nav-title">
                <ActionSettings size={14} aria-hidden="true" />
                Settings
              </p>
              <ul aria-labelledby="ns-settings-nav-title">
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
              <p className="profile-nav-title" id="ns-settings-history-title">
                <ActionHistory size={14} aria-hidden="true" />
                History
              </p>
              <ul aria-labelledby="ns-settings-history-title">
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
        <Outlet context={parentCtx} />
      </div>
    </div>
  )
}
