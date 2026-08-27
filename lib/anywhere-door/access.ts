import type { SessionUser } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { isAnywhereDoorEnabled } from '@/lib/anywhere-door/config'

export async function canAccessAnywhereDoor(user: Pick<SessionUser, 'id' | 'role'>) {
  if (isAnywhereDoorEnabled()) return true
  return hasAdminPermission(user, 'social_manage')
}
