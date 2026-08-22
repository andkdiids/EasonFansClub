import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdminPage } from '@/components/AdminAccess'

import { allAdminPermissionKeys, adminPermissionGroups, isSuperAdmin } from '@/lib/admin-permissions'
import { prisma } from '@/lib/prisma'
import { parseUidParam, formatUid } from '@/lib/uid'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ uid: string }> }

export default async function AdminDetailPage({ params }: PageProps) {
  const currentUser = await requireAdminPage('/admin/admins', 'admin_manage')
  const { uid } = await params
  const numericUid = parseUidParam(uid)
  if (numericUid === null) notFound()

  const admin = await prisma.user.findFirst({
    where: {
      uid: numericUid,
      role: { in: ['ADMIN', 'SUPER_ADMIN'] },
      status: 'ACTIVE',
      isDeleted: false,
    },
    include: {
  Profile: true,
  AdminPermission: {
    orderBy: { permissionKey: 'asc' },
  },
},
  })
  if (!admin) notFound()

  const enabledKeys = isSuperAdmin(admin)
  ? new Set(allAdminPermissionKeys)
  : new Set(
      admin.AdminPermission
        .filter((item) => item.enabled)
        .map((item) => item.permissionKey)
    )

  return (
    <>
      
      <main className="mx-auto max-w-5xl space-y-6 px-5 py-8">
        <section className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
          <Link href="/admin/admins" className="text-sm font-black text-brand-700">返回管理员管理</Link>
          <h1 className="mt-3 text-3xl font-black text-brand-950">管理员详情</h1>
          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl bg-sky-50 p-4">
              <p className="text-xs font-black text-slate-500">UID</p>
              <p className="mt-2 text-xl font-black text-brand-950">{formatUid(admin.uid)}</p>
            </div>
            <div className="rounded-2xl bg-sky-50 p-4">
              <p className="text-xs font-black text-slate-500">昵称</p>
              <p className="mt-2 text-xl font-black text-brand-950">{admin.nickname || 'E院用户'}</p>
            </div>
            <div className="rounded-2xl bg-sky-50 p-4">
              <p className="text-xs font-black text-slate-500">角色</p>
              <p className="mt-2 text-xl font-black text-brand-950">{admin.role}</p>
            </div>
            <div className="rounded-2xl bg-sky-50 p-4">
              <p className="text-xs font-black text-slate-500">查看者</p>
              <p className="mt-2 text-xl font-black text-brand-950">{currentUser.role}</p>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
          <h2 className="text-2xl font-black text-brand-950">当前拥有的权限</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {adminPermissionGroups.map((permission) => {
              const enabled = enabledKeys.has(permission.key)
              return (
                <div key={permission.key} className={`rounded-2xl p-4 ${enabled ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                  <p className={`font-black ${enabled ? 'text-emerald-700' : 'text-slate-400'}`}>{enabled ? '已拥有' : '未开启'} · {permission.label}</p>
                  <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{permission.description}</p>
                </div>
              )
            })}
          </div>
        </section>
      </main>
    </>
  )
}
