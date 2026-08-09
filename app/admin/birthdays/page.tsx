import Link from 'next/link'
import { requireAdminPage } from '@/components/AdminAccess'

import { formatUid } from '@/lib/uid'
import { getTodayMonthDay } from '@/lib/today'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function AdminBirthdaysPage() {
  const currentUser = await requireAdminPage('/admin/birthdays', 'stats_view')
  const { month, day } = getTodayMonthDay()

  const birthdayUsers = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      isDeleted: false,
      birthMonth: month,
      birthDay: day,
    },
    select: {
      uid: true,
      nickname: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <>
      
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-black tracking-[0.18em] text-sky-700">生日管理</p>
            <h1 className="mt-2 text-3xl font-black text-brand-950">今日生日用户</h1>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
              今天是 {month} 月 {day} 日，共 {birthdayUsers.length} 位 E友生日。
            </p>
          </div>
          <Link
            href="/admin"
            className="inline-flex h-11 items-center rounded-xl border border-sky-100 bg-white px-5 text-sm font-black text-brand-800 shadow-sm transition hover:bg-sky-50"
          >
            返回管理后台
          </Link>
        </div>

        <section className="layout-card rounded-[28px] border border-sky-100 bg-white/85 p-4 shadow-sm">
          {birthdayUsers.length === 0 ? (
            <p className="py-10 text-center text-sm font-bold text-slate-500">今天还没有 E友填写生日，或暂无匹配用户。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-sky-100 text-xs font-black tracking-[0.12em] text-slate-500">
                    <th className="px-3 py-3">UID</th>
                    <th className="px-3 py-3">昵称</th>
                    <th className="px-3 py-3">注册时间</th>
                  </tr>
                </thead>
                <tbody>
                  {birthdayUsers.map((item) => (
                    <tr key={item.uid} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-3 font-black text-brand-900">{formatUid(item.uid)}</td>
                      <td className="px-3 py-3 font-bold text-slate-700">{item.nickname}</td>
                      <td className="px-3 py-3 font-bold text-slate-500">{item.createdAt.toISOString().slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 text-xs font-bold leading-5 text-slate-400">
            为保护隐私，本页仅展示 UID、昵称与注册时间，不包含生日日期、年龄与头像。
          </p>
        </section>
      </main>
    </>
  )
}
