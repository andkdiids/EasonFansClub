export type NotificationOrderValue = {
  id: string
  readAt: Date | string | null
  createdAt: Date | string
}

/** The same order used by the database union query, kept for deterministic page serialization/tests. */
export function compareNotificationOrder(a: NotificationOrderValue, b: NotificationOrderValue) {
  const aIsRead = a.readAt !== null
  const bIsRead = b.readAt !== null
  if (aIsRead !== bIsRead) return Number(aIsRead) - Number(bIsRead)
  const createdAtDifference = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  return createdAtDifference || a.id.localeCompare(b.id)
}
