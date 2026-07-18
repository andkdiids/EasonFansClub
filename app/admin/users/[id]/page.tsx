import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { SuperAdminUserActions } from '@/components/SuperAdminUserActions'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'

export const dynamic = 'force-dynamic'

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const currentUser = await requireAdminPage(`/admin/users/${id}`, 'user_manage')
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, uid: true, username: true, nickname: true, email: true, phone: true, role: true, status: true,
      level: true, exp: true, points: true, createdAt: true, lastLoginAt: true, mustSetupSecurity: true,
      profile: { select: { displayName: true, avatarUrl: true } },
      _count: { select: { posts: true, replies: true, checkIns: true, achievements: true, notifications: true } },
    },
  })
  if (!user) notFound()
  const nickname = user.profile?.displayName || user.nickname
  const details = [['UID', formatUid(user.uid)], ['用户名', user.username], ['角色', user.role], ['状态', user.status], ['邮箱', user.email || '未绑定'], ['手机', user.phone || '未绑定'], ['等级', `Lv.${user.level}`], ['积分', String(user.points)]]

  return <><SiteHeader user={currentUser} /><main className="mx-auto max-w-5xl space-y-6 px-4 py-7 sm:px-5 sm:py-9">
    <Link href="/admin/users" className="text-sm font-black text-brand-700">← 返回用户管理</Link>
    <section className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center"><div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-2xl font-black text-white">{user.profile?.avatarUrl ? <img src={user.profile.avatarUrl} alt="" className="size-full object-cover" /> : nickname.slice(0, 1)}</div><div><p className="text-xs font-black tracking-[0.18em] text-brand-700">USER DETAIL</p><h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">{nickname}</h1><p className="mt-2 text-sm font-bold text-slate-500">UID {formatUid(user.uid)} · 注册于 {user.createdAt.toLocaleString('zh-CN', { hour12: false })}</p></div></div>
      <dl className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{details.map(([label, value]) => <div key={label} className="rounded-2xl bg-sky-50 p-4"><dt className="text-xs font-black text-brand-700">{label}</dt><dd className="mt-2 break-all font-black text-brand-950">{value}</dd></div>)}</dl>
      <div className="mt-5 grid gap-3 sm:grid-cols-5">{Object.entries(user._count).map(([label, value]) => <div key={label} className="rounded-2xl border border-sky-100 p-4 text-center"><p className="text-2xl font-black text-brand-950">{value}</p><p className="mt-1 text-xs font-bold text-slate-400">{label}</p></div>)}</div>
      {user.mustSetupSecurity ? <p className="mt-5 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-black text-amber-700">该用户需要重新确认密保设置。</p> : null}
    </section>
    {currentUser.role === 'SUPER_ADMIN' ? <SuperAdminUserActions targetUserId={user.id} initialUid={user.uid} nickname={nickname} /> : null}
  </main></>
}
