/** Public entry point for the notifications module. */
export {
  subscriberId,
  rememberNotificationUser,
  emitNotification,
  notificationFromAudit,
  captureNotificationAudit,
  replayNotificationAudit,
  notificationAvailability,
  registerNotificationRoutes,
  runNotificationWorkerOnce,
  startNotificationWorker,
  notificationReadiness,
} from './lib/notifications.js'
export type {
  NotificationEvent,
  NotificationItem,
  NotificationPreferences,
  NotificationResource,
} from './lib/notifications.js'
export {
  notificationUserKey,
  saveNotificationUser,
  listNotificationUsers,
  getNotificationUser,
  saveNotificationPreferences,
  recordNotificationTombstone,
  listNotificationTombstones,
  getNotificationCursor,
  setNotificationCursor,
} from './lib/notificationsStore.js'
export type {
  NotificationUser,
  KnownNotificationUser,
} from './lib/notificationsStore.js'
export {
  notificationCategories,
  defaultNotificationPreferences,
  parseNotificationPreferences,
  resourceIsMuted,
  notificationQuiet,
  nextNotificationDelivery,
} from './lib/notificationsTypes.js'
export type {
  NotificationCategory,
  NotificationIdentity,
} from './lib/notificationsTypes.js'
export {
  novuConfig,
  WORKFLOW_ID,
  NovuError,
  openNovu,
  getNovu,
  useNovu,
  noteSubscriber,
  purgeTouchedSubscribers,
} from './lib/novu.js'
export type {
  NovuConfig,
  NovuMessage,
  NovuHealth,
  Novu,
} from './lib/novu.js'
