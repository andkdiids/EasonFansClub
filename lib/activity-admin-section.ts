import { getActivityDisplayStatus } from '@/lib/activity'

export const activityAdminSections = [
  { id: 'CURRENT', label: '当前活动' },
  { id: 'DRAFT', label: '草稿' },
  { id: 'ENDED', label: '已结束' },
  { id: 'CANCELLED', label: '已取消' },
] as const
export type ActivityAdminSection = typeof activityAdminSections[number]['id']

export function belongsToActivityAdminSection(activity: Parameters<typeof getActivityDisplayStatus>[0], section: ActivityAdminSection, now = new Date()) {
  const status = getActivityDisplayStatus(activity, now)
  return section === 'CURRENT' ? status === 'ONGOING' || status === 'UPCOMING' : status === section
}
