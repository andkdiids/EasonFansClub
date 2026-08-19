import Link from 'next/link'
import { requireAdminPage } from '@/components/AdminAccess'
import { PageLayoutFrame } from '@/components/page-layout/PageLayoutFrame'
import { adminModulePermissions } from '@/lib/admin-permission-config'
import { getAdminPermissionSet, isSuperAdmin } from '@/lib/admin-permissions'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'

export const dynamic = 'force-dynamic'

type AdminNavigationItem = {
  href: string
  title: string
  desc: string
}

type AdminNavigationGroup = {
  title: string
  desc: string
  items: readonly AdminNavigationItem[]
}

const adminNavigationGroups: readonly AdminNavigationGroup[] = [
  {
    title: '内容安全',
    desc: '统一维护违禁词并处理历史违规内容。',
    items: [
      { href: '/admin/banned-words', title: '违禁词管理', desc: '新增、删除、启停违禁词，并重新扫描全站历史内容。' },
    ],
  },
  {
    title: '数据面板',
    desc: '查看后台运营数据与趋势。',
    items: [
      { href: '/admin/dashboard', title: '打开数据面板', desc: '查看注册、发帖、回复、挂号等核心数据。' },
    ],
  },
  {
    title: '用户管理',
    desc: '维护用户账号与默认资料资源。',
    items: [
      { href: '/admin/users', title: '用户管理', desc: '管理用户状态、权限、昵称冷却和重复账号。' },
      { href: '/admin/default-avatars', title: '默认头像管理', desc: '维护系统默认头像池。' },
      { href: '/admin/user-rewards', title: '用户奖励', desc: '用户投稿、建议或内容被采纳后，记录并发放贡献奖励。' },
    ],
  },
  {
    title: '入院管理',
    desc: '统一管理体检、注册、验证与账户安全。',
    items: [
      { href: '/admin/ehospital', title: 'E院体检设置', desc: '配置听力验证的开关、题量、通过分数和每日次数。' },
      { href: '/admin/security-settings#registration-settings', title: '注册流程设置', desc: '设置注册方式与注册开关。' },
      { href: '/admin/security-settings#verification-settings', title: '验证设置', desc: '设置邮箱、手机和密保验证策略。' },
      { href: '/admin/security-settings#security-settings', title: '账户安全设置', desc: '配置密码找回和账户安全策略。' },
    ],
  },
  {
    title: '内容管理',
    desc: '集中处理首页、帖子、今日内容、留言、生日与公告。',
    items: [
      { href: '/admin/home', title: '首页内容', desc: '管理首页 Hero、文案、排序和启用状态。' },
      { href: '/admin/posts/review', title: '帖子审核', desc: '审核新帖并处理精选、置顶和拒绝。' },
      { href: '/admin/clinic', title: '阿士匹灵门诊部', desc: '处理匿名病历、会诊和举报；后台可核对真实用户身份。' },
      { href: '/admin/today', title: '今日管理', desc: '管理历史上的今天内容并审核用户提交。' },
      { href: '/admin/registration-messages', title: '挂号页留言管理', desc: '管理挂号页留言、公告和活动提醒。' },
      { href: '/admin/stickers', title: '表情包审核', desc: '审核用户提交的表情包合集。' },
      { href: '/admin/birthdays', title: '生日管理', desc: '查看今日生日用户并保护隐私信息。' },
      { href: '/admin/birthday-messages', title: '生日祝福文案', desc: '维护生日纪念通知文案池。' },
      { href: '/admin/notifications', title: '公告管理', desc: '发布与管理后台系统公告。' },
      { href: '/admin/content', title: '活动内容管理', desc: '保留原内容中心入口，管理活动与其他内容入口。' },
    ],
  },
  {
    title: '页面视觉设置',
    desc: '统一管理网站外观、页面媒体与布局。',
    items: [
      { href: '/admin/home', title: '首页 Hero 管理', desc: '管理首页 Hero 图片、文案和排序。' },
      { href: '/admin/appearance', title: '网站整体外观', desc: '修改前台文案、颜色、图片和导航图标。' },
      { href: '/admin/layout-editor', title: '页面布局编辑器', desc: '调整页面模块顺序、宽度、间距和发布状态。' },
      { href: '/admin/visuals', title: '页面视觉总览', desc: '进入登录、注册、欢迎页和首页视觉设置。' },
      { href: '/admin/visuals/login', title: '登录页视觉', desc: '设置登录页背景与响应式构图。' },
      { href: '/admin/visuals/register', title: '注册页视觉', desc: '设置注册页背景与响应式构图。' },
      { href: '/admin/visuals/welcome', title: '欢迎页视觉', desc: '设置欢迎页背景与响应式构图。' },
      { href: '/admin/visuals/home', title: '首页视觉', desc: '设置首页视觉媒体与构图。' },
      { href: '/admin/visuals/activities', title: '活动中心背景', desc: '设置活动中心背景媒体与响应式构图。' },
    ],
  },
  {
    title: '娱乐天空管理',
    desc: '统一进入歌词、听听题库与游戏相关配置。',
    items: [
      { href: '/admin/entertainment/lyrics', title: '歌词处方库', desc: '维护娱乐天空每日抽奖使用的歌词处方。' },
      { href: '/admin/entertainment/guess-song', title: '听听题库', desc: '维护听听题目、答案与私有音频变体。' },
      { href: '/admin/entertainment/guess-song/leaderboard', title: '听听排行榜', desc: '管理听听周榜、月榜、年榜和成绩补分。' },
      { href: '/admin/entertainment/guess-song/duel', title: '听听·对决管理', desc: '查看实时 1v1 对决、结算、断线与风控审计。' },
      { href: '/admin/entertainment/guess-song#game-config', title: '游戏相关配置', desc: '沿用听听管理页中的游戏配置入口。' },
      { href: '/admin/entertainment/want-listen', title: '想听', desc: '管理想听开关、三种模式、假歌名库与基础数据概览。' },
      { href: '/admin/entertainment/want-listen/leaderboard', title: '想听排行榜', desc: '管理想听、粤语残片、防不胜防排行榜成绩。' },
      { href: '/admin/entertainment/undercover-star', title: '卧底巨星', desc: '管理房间制多人游戏开关、词组难度、分类与使用统计。' },
      { href: '/admin/music/songs', title: '曲库管理', desc: '从 EasMusic 歌曲库维护游戏可用曲目。' },
    ],
  },
  {
    title: 'EasMusic管理',
    desc: '维护音乐专辑、歌曲、巡演和现场资料。',
    items: [
      { href: '/admin/music', title: 'EasMusic 管理', desc: '进入 EasMusic 管理总览及其子模块。' },
      { href: '/admin/ratings', title: '歌·颂管理', desc: '查看评分统计，处理违规短评；歌曲和专辑仍由曲库管理。' },
    ],
  },
  {
    title: '成就系统',
    desc: '管理成就、勋章与成长系统配置。',
    items: [
      { href: '/admin/achievements', title: '成就 / 勋章管理', desc: '管理成就、勋章、稀有度、条件和手动发放。' },
      { href: '/admin/growth', title: '成长系统管理', desc: '维护等级名称、升级经验和任务奖励。' },
    ],
  },
  {
    title: 'Eason 文化馆',
    desc: '维护歌曲、专辑、电影和 Live 档案。',
    items: [
      { href: '/admin/culture', title: 'Eason 文化馆管理', desc: '管理歌曲百科、专辑馆、电影馆、Live 档案和每日一句。' },
    ],
  },
  {
    title: '管理员管理',
    desc: '维护后台管理员与权限分配。',
    items: [
      { href: '/admin/admins', title: '管理员管理', desc: '添加管理员、移除管理员并编辑后台权限。' },
      { href: '/admin/admin-actions', title: '管理员操作记录', desc: '按管理员、操作类型、对象和时间追溯内容管理操作。' },
    ],
  },
  {
    title: '更新与反馈',
    desc: '发布后台更新记录并处理用户反馈。',
    items: [
      { href: '/admin/changelog', title: '更新日志管理', desc: '发布网站更新记录与功能说明。' },
      { href: '/admin/feedback', title: '用户反馈管理', desc: '查看、回复和关闭用户反馈。' },
    ],
  },
] as const

function routeFromHref(href: string) {
  return href.split(/[?#]/, 1)[0]
}

function permissionForRoute(route: string) {
  const exact = adminModulePermissions[route]
  if (exact) return exact

  const parentRoute = Object.keys(adminModulePermissions)
    .filter((candidate) => route.startsWith(`${candidate}/`))
    .sort((a, b) => b.length - a.length)[0]
  return parentRoute ? adminModulePermissions[parentRoute] : undefined
}

export default async function AdminPage() {
  const currentUser = await requireAdminPage('/admin')
  const permissionSet = await getAdminPermissionSet(currentUser)
  const superAdmin = isSuperAdmin(currentUser)
  const canViewRoute = (href: string) => {
    if (superAdmin) return true
    const permission = permissionForRoute(routeFromHref(href))
    return Boolean(permission && permissionSet.has(permission))
  }
  const visibleGroups = adminNavigationGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => canViewRoute(item.href)) }))
    .filter((group) => group.items.length > 0)
  const layoutConfig = await getPublishedPageLayoutConfig('admin-home')
  const headerLayout = layoutConfig.desktop.find((item) => item.key === 'admin.header')
  const modulesLayout = layoutConfig.desktop.find((item) => item.key === 'admin.modules')

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:gap-6 sm:px-5 sm:py-7">
      {headerLayout ? (
        <PageLayoutFrame config={headerLayout}>
          <section className="layout-card rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm sm:p-8">
            <p className="text-sm font-black tracking-[0.18em] text-brand-700">管理后台</p>
            <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">{headerLayout.title || '管理后台'}</h1>
            <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600 sm:text-base">
              {headerLayout.subtitle || '管理用户、内容、站点视觉、EasMusic、成就系统和 Eason 文化馆。'}
            </p>
          </section>
        </PageLayoutFrame>
      ) : null}

      {modulesLayout ? (
        <PageLayoutFrame config={modulesLayout}>
          <section className="layout-card rounded-[28px] border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-6">
            <div className="mb-5">
              <h2 className="text-2xl font-black text-brand-950">功能入口导航</h2>
              <p className="mt-2 text-sm font-bold leading-6 text-slate-600">按业务模块进入后台管理页面，统计数据不在首页重复展示。</p>
            </div>
            <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleGroups.map((group) => (
                <details key={group.title} className="group min-w-0 rounded-2xl border border-sky-100 bg-white/80 transition-colors open:bg-white">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0">
                      <span className="block text-lg font-black text-brand-950">{group.title}</span>
                      <span className="mt-1 block text-xs font-bold leading-5 text-slate-500">{group.desc}</span>
                    </span>
                    <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-lg font-black leading-none text-brand-700 transition-transform group-open:rotate-180">⌄</span>
                  </summary>
                  <nav className="grid min-w-0 gap-2 border-t border-sky-100 px-3 pb-3 pt-3" aria-label={`${group.title}子菜单`}>
                    {group.items.map((item) => (
                      <Link
                        key={`${group.title}-${item.href}-${item.title}`}
                        href={item.href}
                        className="min-w-0 rounded-xl border border-sky-100 bg-sky-50/55 px-3 py-3 transition hover:border-sky-300 hover:bg-sky-50"
                      >
                        <span className="block break-words text-sm font-black text-brand-950">{item.title}</span>
                        <span className="mt-1 block break-words text-xs font-bold leading-5 text-slate-500">{item.desc}</span>
                      </Link>
                    ))}
                  </nav>
                </details>
              ))}
            </div>
          </section>
        </PageLayoutFrame>
      ) : null}
    </main>
  )
}
