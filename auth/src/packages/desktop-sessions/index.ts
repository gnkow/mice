/**
 * Public entry point for the desktop-sessions module.
 * Intentional surface: session lifecycle, boot hooks, and public types.
 * Niche store/provisioner/mount helpers stay on root strangler shims.
 */
export type {
  DesktopSession,
  PublicDesktopSession,
  SessionCreateBody,
  SessionMount,
  SessionMountInput,
  SessionResources,
  DesktopSessionStatus,
  SessionTemplate,
} from './lib/sessionsTypes.js'

export {
  guestUserFromOwner,
  publicSession,
  parseMountsList,
  parseCreateBody,
  authorizeSessionMounts,
  authorizeSessionCreate,
  authorizeSessionAccess,
  createDesktopSession,
  listDesktopSessions,
  connectDesktopSession,
  stopDesktopSession,
  retryDesktopSession,
  remountDesktopSession,
  updateSessionMounts,
  destroyDesktopSession,
  markSessionDisconnect,
  resumeInterruptedProvisions,
  startSessionsLifecycleSweeper,
  sessionsAuditRetentionPolicy,
} from './lib/sessions.js'

export { attachSessionsGuacGateway } from './lib/sessionsGateway.js'
export { startSessionLeaseRenewer } from './lib/sessionsWorkspaces.js'
export { listSessionTemplates, getSessionTemplate } from './lib/sessionsTemplates.js'
export { peekConnectTicket } from './lib/sessionsConnect.js'


export { getSessionRecord, listSessions, updateSession } from './lib/sessionsStore.js'
