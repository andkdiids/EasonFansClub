import Link from 'next/link'
import { requireAdminPage } from '@/components/AdminAccess'
import { AdminUsersManager } from '@/components/AdminUsersManager'

import { adminModulePermissions, hasAdminPermission } from '@/lib/admin-permissions'

export default async function AdminUsersPage() {
  const user = await requireAdminPage('/admin/users', adminModulePermissions['/admin/users'])
  const canManageAccountSecurity = await hasAdminPermission(user, 'account_security_manage')
  const canManageUserEmail = await hasAdminPermission(user, 'user_manage')

  return (
    <>
      
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-5 sm:py-8">
        <section className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm sm:p-8">
          <p className="text-sm font-black tracking-[0.18em] text-brand-700">管理后台</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">用户管理</h1>
          <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600 sm:text-base">
            管理用户状态、管理员权限、封禁和永久删除。永久删除前必须核对影响范围并输入 UID。
          </p>
          <Link href="/admin" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brand-950 px-5 text-sm font-black text-white">
            返回后台首页
          </Link>
        </section>
        <AdminUsersManager canManageAccountSecurity={canManageAccountSecurity} canManageUserEmail={canManageUserEmail} />
      </main>
    </>
  )
}
