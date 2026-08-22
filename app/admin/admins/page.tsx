import { requireAdminPage } from '@/components/AdminAccess'

import { adminModulePermissions } from '@/lib/admin-permissions'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { AdminManager } from './AdminManager'

export const dynamic = 'force-dynamic'

export default async function AdminAdminsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const currentUser = await requireAdminPage('/admin/admins', adminModulePermissions['/admin/admins'])
  const params = await searchParams
  const q = (params.q || '').trim()
  const numericUid = Number(q)

  const [admins, searchUsers, logs] = await Promise.all([
  prisma.user.findMany({
    where: {
      isDeleted: false,
      status: 'ACTIVE',
      role: { in: ['ADMIN', 'SUPER_ADMIN'] },
      Profile: { isNot: null },
    },
    orderBy: [{ role: 'desc' }, { createdAt: 'asc' }],
    include: {
      Profile: true,
      AdminPermission: {
        where: { enabled: true },
        select: { permissionKey: true },
      },
    },
  }),

  q
    ? prisma.user.findMany({
        where: {
          isDeleted: false,
          status: 'ACTIVE',
          Profile: { isNot: null },
          OR: [
            ...(Number.isInteger(numericUid) ? [{ uid: numericUid }] : []),
            { nickname: { contains: q } },
            { Profile: { displayName: { contains: q } } },
            { phone: q },
            { email: { contains: q } },
          ],
        },
        take: 12,
        include: {
          Profile: true,
        },
      })
    : Promise.resolve([]),

  prisma.adminAction.findMany({
    where: { action: 'UPDATE_USER_ROLE' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
  User_AdminAction_adminIdToUser: {
    select: {
      nickname: true,
      Profile: {
        select: {
          displayName: true,
        },
      },
    },
  },
  User_AdminAction_targetUserIdToUser: {
    select: {
      nickname: true,
      Profile: {
        select: {
          displayName: true,
        },
      },
    },
  },
},
  }),
])

  return (
    <>
      
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-8">
        <AdminManager
          query={q}
          admins={admins.map((user) => ({
            id: user.id,
            uid: user.uid,
            nickname: user.nickname || 'E院用户',
            email: user.email,
            phone: user.phone,
            role: user.role,
            createdAt: user.createdAt,
            permissions: user.AdminPermission.map((item) => item.permissionKey),
            canPlayFullMusic: user.canPlayFullMusic,
          }))}
          searchUsers={searchUsers.map((user) => ({
            id: user.id,
            uid: user.uid,
            nickname: user.nickname,
            email: user.email,
            phone: user.phone,
            role: user.role,
            status: user.status,
            profile: user.Profile ? { displayName: user.Profile.displayName, avatarUrl: publicImageUrl(user.Profile.avatarUrl) } : null,
            canPlayFullMusic: false,
          }))}
          logs={logs.map((log) => ({
            id: log.id,
            action: log.action,
            reason: log.reason,
            createdAt: log.createdAt,
            adminName:
  log.User_AdminAction_adminIdToUser?.nickname ||
  log.User_AdminAction_adminIdToUser?.nickname ||
  '原管理员账号已不存在',

targetName:
  log.User_AdminAction_targetUserIdToUser
    ? log.User_AdminAction_targetUserIdToUser.nickname ||
      log.User_AdminAction_targetUserIdToUser.nickname ||
      'E院用户'
    : null,
          }))}
          canManageUserRewardPermission={currentUser.role === 'SUPER_ADMIN'}
        />
      </main>
    </>
  )
}
