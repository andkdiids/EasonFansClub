import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentUser, type SessionUser } from '@/lib/auth'
import { type AdminPermissionKey, hasAdminPermission, isAdminUser } from '@/lib/admin-permissions'

export async function requireAdminPage(path = '/admin', permissionKey?: AdminPermissionKey): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) redirect(`/login?redirect=${encodeURIComponent(path)}`)
  if (!isAdminUser(user)) redirect(`/admin/no-access?from=${encodeURIComponent(path)}`)

  const allowed = await hasAdminPermission(user, permissionKey)
  if (!allowed) redirect(`/admin/no-access?from=${encodeURIComponent(path)}`)

  return user
}

export function AdminNoAccess() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-3xl items-center px-5 py-10">
        <section className="w-full rounded-[28px] border border-sky-100 bg-white/85 p-6 text-center shadow-sm sm:p-10">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-brand-700">Admin</p>
          <h1 className="mt-3 text-3xl font-black text-brand-950 sm:text-4xl">无权限访问后台</h1>
          <p className="mx-auto mt-4 max-w-xl text-sm font-bold leading-7 text-slate-600 sm:text-base">
            当前账号没有访问该后台模块的权限。你仍然可以返回社区继续浏览。
          </p>
          <Link href="/" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brand-700 px-5 text-sm font-black text-white">
            返回首页
          </Link>
        </section>
      </main>
  )
}
