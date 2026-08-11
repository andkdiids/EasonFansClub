export type NotificationOrderValue = {
  id: string
  isRead: boolean
  createdAt: Date | string
}

/** The same order used by the database union query, kept for deterministic page serialization/tests. */
export function compareNotificationOrder(a: NotificationOrderValue, b: NotificationOrderValue) {
  if (a.isRead !== b.isRead) return Number(a.isRead) - Number(b.isRead)
  const createdAtDifference = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  return createdAtDifference || a.id.localeCompare(b.id)
}
