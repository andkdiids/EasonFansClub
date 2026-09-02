import { requireAdminPage } from '@/components/AdminAccess'
import { STUDIO_TOOLS, getStudioTool, studioToolStatusLabel } from '@/lib/studio/tools'
import { prisma } from '@/lib/prisma'
import { StudioAdminPanel } from './StudioAdminPanel'

export const dynamic = 'force-dynamic'

function metadata(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { width: null, height: null, totalBeads: 0 }
  const pattern = (data as Record<string, unknown>).pattern
  if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern)) return { width: null, height: null, totalBeads: 0 }
  const row = pattern as Record<string, unknown>
  const cells = Array.isArray(row.cells) ? row.cells : []
  return { width: typeof row.width === 'number' ? row.width : null, height: typeof row.height === 'number' ? row.height : null, totalBeads: cells.filter((cell) => typeof cell === 'number' && cell >= 0).length }
}

export default async function AdminStudioPage() {
  await requireAdminPage('/admin/studio', 'studio_manage')
  const [total, pending, published, engagement, projects] = await Promise.all([
    prisma.studioProject.count(),
    prisma.studioProject.count({ where: { reviewStatus: 'PENDING' } }),
    prisma.studioProject.count({ where: { visibility: 'PUBLIC', reviewStatus: 'APPROVED' } }),
    prisma.studioProject.aggregate({ _sum: { likeCount: true, favoriteCount: true, viewCount: true } }),
    prisma.studioProject.findMany({ where: { reviewStatus: 'PENDING' }, orderBy: { updatedAt: 'desc' }, take: 100, select: { id: true, toolSlug: true, title: true, description: true, reviewStatus: true, visibility: true, createdAt: true, User: { select: { uid: true, nickname: true } }, data: true } }),
  ])
  const rows = projects.map((project) => ({ ...project, toolName: getStudioTool(project.toolSlug)?.name || '创作项目', metadata: metadata(project.data), createdAt: project.createdAt.toISOString() }))
  return <main className="admin-mobile-page mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-5 sm:py-9">
    <section className="border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8"><p className="text-sm font-black tracking-[0.18em] text-brand-700">管理后台 · 贝多芬与我</p><h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">创作平台管理</h1><p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600">工具状态由统一注册表驱动；公开作品必须经过审核，私密项目不会出现在公开访问流程。</p></section>
    <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6"><div className="border border-sky-100 bg-white/90 p-5"><span className="text-xs font-black text-slate-500">项目总数</span><strong className="mt-2 block text-3xl font-black text-brand-950">{total}</strong></div><div className="border border-amber-200 bg-amber-50/70 p-5"><span className="text-xs font-black text-amber-800">待审核</span><strong className="mt-2 block text-3xl font-black text-amber-900">{pending}</strong></div><div className="border border-emerald-200 bg-emerald-50/70 p-5"><span className="text-xs font-black text-emerald-800">已公开</span><strong className="mt-2 block text-3xl font-black text-emerald-900">{published}</strong></div><div className="border border-rose-200 bg-rose-50/70 p-5"><span className="text-xs font-black text-rose-800">点赞</span><strong className="mt-2 block text-3xl font-black text-rose-900">{engagement._sum.likeCount || 0}</strong></div><div className="border border-orange-200 bg-orange-50/70 p-5"><span className="text-xs font-black text-orange-800">收藏</span><strong className="mt-2 block text-3xl font-black text-orange-900">{engagement._sum.favoriteCount || 0}</strong></div><div className="border border-indigo-200 bg-indigo-50/70 p-5"><span className="text-xs font-black text-indigo-800">浏览</span><strong className="mt-2 block text-3xl font-black text-indigo-900">{engagement._sum.viewCount || 0}</strong></div></section>
    <section className="border border-sky-100 bg-white/90 p-5 sm:p-6"><h2 className="text-lg font-black text-brand-950">工具状态</h2><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{STUDIO_TOOLS.map((tool) => <div key={tool.slug} className="flex items-center justify-between gap-3 border border-sky-100 bg-sky-50/45 p-3"><div><strong className="block text-sm font-black text-brand-950">{tool.name}</strong><span className="mt-1 block text-xs font-bold text-slate-500">{tool.route}</span></div><span className="text-xs font-black text-brand-700">{studioToolStatusLabel(tool.status)}</span></div>)}</div></section>
    <StudioAdminPanel initialProjects={rows} />
  </main>
}
