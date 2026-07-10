import Link from 'next/link'
import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { adminModulePermissions } from '@/lib/admin-permission-config'
import { getAdminPermissionSet, isSuperAdmin } from '@/lib/admin-permissions'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const adminModules = [
  { href: '/admin/dashboard', title: '数据面板', desc: '查看注册、发帖、回复、挂号等核心数据。' },
  { href: '/admin/users', title: '用户管理', desc: '管理用户状态、权限、昵称冷却和重复账号。' },
  { href: '/admin/settings', title: '网站设置', desc: '配置站点名称、SEO、页脚和联系方式。' },
  { href: '/admin/content', title: '内容管理', desc: '管理首页模块、公告、板块、活动和友情链接。' },
  { href: '/admin/achievements', title: '成就 / 勋章', desc: '管理成就、勋章、稀有度、条件和手动发放。' },
  { href: '/admin/culture', title: 'Eason 文化馆', desc: '管理歌曲百科、专辑馆、电影馆、Live 档案和每日一句。' },
  { href: '/admin/music', title: 'EasMusic', desc: '配置音乐馆服务状态、推荐歌曲和听歌记录。' },
  { href: '/admin/feedback', title: '反馈中心', desc: '查看用户反馈，回复并更新处理状态。' },
  { href: '/admin/admins', title: '管理员管理', desc: '添加管理员、移除管理员并编辑后台权限。' },
  { href: '/admin/appearance', title: '网站外观配置', desc: '修改前台文案、颜色、图片、导航图标和首页轮播。' },
] as const

export default async function AdminPage() {
  const currentUser = await requireAdminPage('/admin')
  const permissionSet = await getAdminPermissionSet(currentUser)
  const visibleModules = adminModules.filter((item) => {
    if (isSuperAdmin(currentUser)) return true
    const permission = adminModulePermissions[item.href]
    return permission ? permissionSet.has(permission) : true
  })

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [users, posts, replies, checkIns, achievements, cultureItems] = await Promise.all([
    prisma.user.count({ where: { isDeleted: false, status: 'ACTIVE' } }),
    prisma.post.count({ where: { isDeleted: false } }),
    prisma.reply.count({ where: { isDeleted: false } }),
    prisma.checkIn.count({ where: { createdAt: { gte: today } } }),
    prisma.achievement.count().catch(() => 0),
    prisma.cultureItem.count().catch(() => 0),
  ])

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-5 sm:py-8">
        <section className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm sm:p-7">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Admin Center</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">管理后台</h1>
          <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600 sm:text-base">
            管理用户、帖子、板块、挂号、站点外观、EasMusic、成就系统和 Eason 文化馆。
          </p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {[
            ['活跃用户', users],
            ['帖子总数', posts],
            ['回复总数', replies],
            ['今日挂号', checkIns],
            ['成就数量', achievements],
            ['文化内容', cultureItems],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm">
              <p className="text-sm font-bold text-slate-500">{label}</p>
              <p className="mt-2 text-3xl font-black text-brand-950">{value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {visibleModules.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-2xl border border-sky-100 bg-white/82 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <h2 className="text-lg font-black text-brand-950">{item.title}</h2>
              <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{item.desc}</p>
            </Link>
          ))}
        </section>
      </main>
    </>
  )
}
