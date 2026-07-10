import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { adminModulePermissions } from '@/lib/admin-permissions'
import { prisma } from '@/lib/prisma'
import { AdminManager } from './AdminManager'

export const dynamic = 'force-dynamic'

export default async function AdminAdminsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdminPage('/admin/admins', adminModulePermissions['/admin/admins'])
  const params = await searchParams
  const q = (params.q || '').trim()
  const numericUid = Number(q)

  const [admins, searchUsers, logs] = await Promise.all([
    prisma.user.findMany({
      where: {
        isDeleted: false,
        status: 'ACTIVE',
        role: { in: ['ADMIN', 'SUPER_ADMIN'] },
        profile: { isNot: null },
      },
      orderBy: [{ role: 'desc' }, { createdAt: 'asc' }],
      include: {
        profile: true,
        adminPermissions: { where: { enabled: true }, select: { permissionKey: true } },
      },
    }),
    q
      ? prisma.user.findMany({
          where: {
            isDeleted: false,
            status: 'ACTIVE',
            profile: { isNot: null },
            OR: [
              ...(Number.isInteger(numericUid) ? [{ uid: numericUid }] : []),
              { nickname: { contains: q, mode: 'insensitive' } },
              { profile: { displayName: { contains: q, mode: 'insensitive' } } },
              { phone: q },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          },
          take: 12,
          include: { profile: true },
        })
      : Promise.resolve([]),
    prisma.adminAction.findMany({
      where: { action: 'UPDATE_USER_ROLE' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        admin: { select: { nickname: true, profile: { select: { displayName: true } } } },
        targetUser: { select: { nickname: true, profile: { select: { displayName: true } } } },
      },
    }),
  ])

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-8">
        <AdminManager
          query={q}
          admins={admins.map((user) => ({
            id: user.id,
            uid: user.uid,
            nickname: user.profile?.displayName || user.nickname,
            email: user.email,
            phone: user.phone,
            role: user.role,
            createdAt: user.createdAt,
            permissions: user.adminPermissions.map((item) => item.permissionKey),
          }))}
          searchUsers={searchUsers.map((user) => ({
            id: user.id,
            uid: user.uid,
            nickname: user.nickname,
            email: user.email,
            phone: user.phone,
            role: user.role,
            status: user.status,
            profile: user.profile ? { displayName: user.profile.displayName, avatarUrl: user.profile.avatarUrl } : null,
          }))}
          logs={logs.map((log) => ({
            id: log.id,
            action: log.action,
            reason: log.reason,
            createdAt: log.createdAt,
            adminName: log.admin.profile?.displayName || log.admin.nickname,
            targetName: log.targetUser ? log.targetUser.profile?.displayName || log.targetUser.nickname : null,
          }))}
        />
      </main>
    </>
  )
}
