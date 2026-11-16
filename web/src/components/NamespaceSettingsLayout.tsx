import {
  History as ActionHistory,
  Pencil as ActionPencil,
  Settings as ActionSettings,
  ShieldCheck as ActionShieldCheck,
  ShieldAlert as ActionShieldAlert,
  Users as ActionUsers,
  Wrench as ActionWrench,
} from 'lucide-react'
import { NavLink, Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom'
import { SectionNav } from './SectionNav'

const SETTINGS_NAV_GROUPS = [
  {
    title: 'Settings',
    items: [
      { id: 'ns-general', label: 'General', Icon: ActionSettings },
      { id: 'ns-rename', label: 'Rename', Icon: ActionPencil },
      { id: 'ns-members', label: 'Members', Icon: ActionUsers },
      { id: 'ns-approvers', label: 'Approvers', Icon: ActionShieldCheck },
      { id: 'ns-custom-roles', label: 'Custom roles', Icon: ActionWrench },
      { id: 'ns-danger', label: 'Danger zone', Icon: ActionShieldAlert },
    ],
  },
]

const HISTORY_LINKS = [
  { path: 'history', label: 'Settings history' },
  { path: 'members/history', label: 'Membership history' },
  { path: 'custom-roles/history', label: 'Custom roles history' },
]

/** Left section nav + outlet for `/n/:namespace/settings/*`. */
export function NamespaceSettingsLayout() {
  const { namespace = '' } = useParams()
  const location = useLocation()
  const parentCtx = useOutletContext()
  const base = `/n/${encodeURIComponent(namespace)}/settings`
  const onHistory = /\/settings\/(?:history|members\/history|custom-roles\/history)\/?$/.test(location.pathname)

  return (
    <div className="profile-layout ns-settings-layout">
      <aside className="ns-settings-aside" aria-label="Settings sections">
        {onHistory ? (
          <nav className="profile-nav" aria-label="Settings sections">
            <div className="profile-nav-group">
              <p className="profile-nav-title" id="ns-settings-nav-title">
                Settings
              </p>
              <ul aria-labelledby="ns-settings-nav-title">
                {SETTINGS_NAV_GROUPS[0].items.map(({ id, label, Icon }) => (
                  <li key={id}>
                    <NavLink to={`${base}#${id}`}>
                      <Icon size={16} aria-hidden="true" />
                      {label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        ) : (
          <SectionNav label="Settings sections" groups={SETTINGS_NAV_GROUPS} />
        )}
        {HISTORY_LINKS.map(({ path, label }) => (
          <NavLink
            key={path}
            to={`${base}/${path}`}
            className={({ isActive }) =>
              `ns-settings-history-link${isActive ? ' active' : ''}`
            }
          >
            <ActionHistory size={14} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </aside>
      <div className="profile-main ns-settings-main">
        <Outlet context={parentCtx} />
      </div>
    </div>
  )
}
