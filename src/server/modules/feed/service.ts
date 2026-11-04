/**
 * Backwards-compatible entry point. Activity and notification logic moved to
 * modules/collaboration in Phase 4 (pagination, deadline sweep, read/unread).
 */
export {
  listActivity,
  listActivityPage,
  listNotificationPage,
  listNotifications,
  setReadState,
} from "@/server/modules/collaboration/service";