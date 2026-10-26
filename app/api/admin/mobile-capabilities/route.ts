import { NextResponse } from 'next/server'
import { getAdminPermissionSet, type AdminPermissionKey } from '@/lib/admin-permissions'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const MODULES = [
  { id: 'content-safety', label: '内容安全', permissions: ['post_manage'], apiAvailable: true },
  { id: 'users', label: '用户管理', permissions: ['user_manage'], apiAvailable: true },
  { id: 'dashboard', label: '数据面板', permissions: ['stats_view'], apiAvailable: true },
  { id: 'content', label: '内容管理', permissions: ['post_manage', 'reply_manage', 'board_manage'], apiAvailable: true },
  { id: 'materials', label: '物料兑换', permissions: ['material_redemption_manage'], apiAvailable: true },
  { id: 'entertainment', label: '娱乐天空管理', permissions: ['entertainment_manage'], apiAvailable: true },
  { id: 'badges', label: '成就管理', permissions: ['achievement_manage'], apiAvailable: true },
  { id: 'admins', label: '管理员管理', permissions: ['admin_manage'], apiAvailable: true },
  { id: 'easmusic-dog', label: 'EasMusic 狗管理', permissions: ['music_manage'], apiAvailable: false },
  { id: 'updates-feedback', label: '更新与反馈', permissions: ['feedback_manage'], apiAvailable: true },
] as const

export async function GET() {
  const guard = await requireAdmin()
  if (!guard.user) return guard.response
  const allowed = await getAdminPermissionSet(guard.user)
  const modules = MODULES.flatMap((module) => {
    const scopes = module.permissions.filter((permission) => allowed.has(permission as AdminPermissionKey))
    return scopes.length ? [{ id: module.id, label: module.label, available: module.apiAvailable, scopes }] : []
  })
  return NextResponse.json({ modules }, { headers: { 'Cache-Control': 'private, no-store' } })
}
