export const notificationCategoryValues = ['all', 'reply', 'like', 'application', 'feedback', 'system', 'review'] as const
export type NotificationCategory = typeof notificationCategoryValues[number]

export function parseNotificationCategory(value: unknown): NotificationCategory {
  if (notificationCategoryValues.includes(value as NotificationCategory)) return value as NotificationCategory
  // Keep old bookmarked URLs harmless: the removed tabs resolve to the main
  // feed instead of querying private-message or wall-only rows.
  if (value === 'friend') return 'application'
  return 'all'
}
