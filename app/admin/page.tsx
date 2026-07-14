import Link from 'next/link'
import { requireAdminPage } from '@/components/AdminAccess'
import { PageLayoutFrame } from '@/components/page-layout/PageLayoutFrame'
import { SiteHeader } from '@/components/SiteHeader'
import { adminModulePermissions } from '@/lib/admin-permission-config'
import { getAdminPermissionSet, isSuperAdmin } from '@/lib/admin-permissions'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { prisma } from '@/lib/prisma'
import { getRegistrationPolicy } from '@/lib/registration'

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
  { href: '/admin/changelog', title: '更新日志', desc: '发布网站更新记录，让用户了解新功能和修复。' },
  { href: '/admin/notifications', title: '全站通知', desc: '向所有用户发布系统通知，并查看已读和未读统计。' },
  { href: '/admin/admins', title: '管理员管理', desc: '添加管理员、移除管理员并编辑后台权限。' },
  { href: '/admin/appearance', title: '网站外观配置', desc: '修改前台文案、颜色、图片、导航图标和首页轮播。' },
  { href: '/admin/layout-editor', title: '页面布局编辑器', desc: '调整首页、每日挂号和后台首页的模块顺序、宽度、间距和发布状态。' },
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

  const [users, posts, replies, checkIns, achievements, cultureItems, registrationPolicy, layoutConfig] = await Promise.all([
    prisma.user.count({ where: { isDeleted: false, status: 'ACTIVE' } }),
    prisma.post.count({ where: { isDeleted: false } }),
    prisma.reply.count({ where: { isDeleted: false } }),
    prisma.checkIn.count({ where: { createdAt: { gte: today } } }),
    prisma.achievement.count().catch(() => 0),
    prisma.cultureItem.count().catch(() => 0),
    getRegistrationPolicy(),
    getPublishedPageLayoutConfig('admin-home'),
  ])
  const layoutModules = [...layoutConfig.desktop].filter((item) => item.visible).sort((a, b) => a.order - b.order)

  return (
    <>
      <SiteHeader user={currentUser} />
      <main className="mx-auto flex max-w-6xl flex-wrap gap-x-5 px-4 py-5 sm:px-5 sm:py-7">
        {layoutModules.map((layoutItem) => {
          if (layoutItem.key === 'admin.header') {
            return (
              <PageLayoutFrame key={layoutItem.key} config={layoutItem}>
                <section className="layout-card rounded-[28px] border border-sky-100 bg-white/85 shadow-sm">
                  <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Admin Center</p>
                  <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">{layoutItem.title || '管理后台'}</h1>
                  <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600 sm:text-base">
                    {layoutItem.subtitle || '管理用户、帖子、板块、挂号、站点外观、EasMusic、成就系统和 Eason 文化馆。'}
                  </p>
                </section>
              </PageLayoutFrame>
            )
          }

          if (layoutItem.key === 'admin.registrationStatus') {
            return (
              <PageLayoutFrame key={layoutItem.key} config={layoutItem}>
                <section className={`layout-card rounded-[28px] border shadow-sm ${registrationPolicy.envForcedClosed ? 'border-red-100 bg-red-50' : registrationPolicy.registrationMode === 'PHONE' ? 'border-amber-100 bg-amber-50' : 'border-sky-100 bg-white/85'}`}>
                  <h2 className="text-lg font-black text-brand-950">{layoutItem.title || '注册状态'}</h2>
                  <div className="mt-3 grid gap-2 text-sm font-bold text-slate-600 md:grid-cols-3">
                    <p>当前注册模式：{registrationPolicy.registrationModeLabel}</p>
                    <p>手机号验证：未启用短信验证</p>
                    <p>环境总开关：{registrationPolicy.allowRegister ? '允许注册' : '强制关闭注册'}</p>
                  </div>
                  {registrationPolicy.envForcedClosed ? (
                    <p className="mt-3 text-sm font-black text-red-700">注册已被服务器环境变量强制关闭，后台注册模式无法覆盖。</p>
                  ) : null}
                  {registrationPolicy.registrationMode === 'PHONE' ? (
                    <p className="mt-3 text-sm font-black text-amber-800">当前手机号注册未验证号码归属，请仅用于备案期间或受控测试。</p>
                  ) : null}
                </section>
              </PageLayoutFrame>
            )
          }

          if (layoutItem.key === 'admin.stats') {
            return (
              <PageLayoutFrame key={layoutItem.key} config={layoutItem}>
                <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  {[
                    ['活跃用户', users],
                    ['帖子总数', posts],
                    ['回复总数', replies],
                    ['今日挂号', checkIns],
                    ['成就数量', achievements],
                    ['文化内容', cultureItems],
                  ].map(([label, value]) => (
                    <div key={label} className="layout-card rounded-2xl border border-sky-100 bg-white/80 shadow-sm">
                      <p className="text-sm font-bold text-slate-500">{label}</p>
                      <p className="mt-2 text-3xl font-black text-brand-950">{value}</p>
                    </div>
                  ))}
                </section>
              </PageLayoutFrame>
            )
          }

          if (layoutItem.key === 'admin.modules') {
            return (
              <PageLayoutFrame key={layoutItem.key} config={layoutItem}>
                {layoutItem.title || layoutItem.subtitle ? (
                  <div className="mb-4">
                    {layoutItem.title ? <h2 className="text-2xl font-black text-brand-950">{layoutItem.title}</h2> : null}
                    {layoutItem.subtitle ? <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{layoutItem.subtitle}</p> : null}
                  </div>
                ) : null}
                <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {visibleModules.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="layout-card rounded-2xl border border-sky-100 bg-white/82 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <h2 className="text-lg font-black text-brand-950">{item.title}</h2>
                      <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{item.desc}</p>
                    </Link>
                  ))}
                </section>
              </PageLayoutFrame>
            )
          }

          if (layoutItem.key === 'admin.deploymentStatus') {
            return (
              <PageLayoutFrame key={layoutItem.key} config={layoutItem}>
                <section className="layout-card rounded-[28px] border border-sky-100 bg-white/85 shadow-sm">
                  <h2 className="text-lg font-black text-brand-950">{layoutItem.title || '部署状态'}</h2>
                  <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
                    {layoutItem.subtitle || '生产环境由 GitHub Actions 与 PM2 部署流程管理。'}
                  </p>
                </section>
              </PageLayoutFrame>
            )
          }

          return null
        })}
      </main>
    </>
  )
}
