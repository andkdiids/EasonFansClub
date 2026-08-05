import Link from 'next/link'
import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'

export default async function AdminMusicPage() {
  const user = await requireAdminPage('/admin/music', 'music_manage')
  const modules = [
    ['/admin/music/albums', '专辑管理', '创建专辑、上传 WebP 封面、编辑并控制发布状态。'],
    ['/admin/music/songs', '歌曲管理', '查看和维护全部歌曲资料。'],
    ['/admin/music/singles', '单曲管理', '维护标记为单曲发行的歌曲内容。'],
    ['/admin/music/live', 'Live 版本管理', '维护演唱会和现场版本资料。'],
    ['/admin/music/tours', '巡演管理', '维护 Eason in Concert 的巡演档案、海报、发布状态与排序。'],
    ['/admin/music/concerts', '演唱会管理', '维护场次、现场歌单、特别时刻与复制录入。'],
    ['/admin/music/badges', '演唱会徽章', '为巡演创建纪念徽章，用户看过对应场次后自动获得。'],
    ['/admin/music/reviews', '专辑鉴赏管理', '发布专辑幕后故事、制作资料、歌曲解析和多图深度档案。'],
  ] as const
  return <><SiteHeader user={user} /><main className="admin-mobile-page mx-auto max-w-6xl space-y-7 px-4 py-7 sm:px-5 sm:py-9">
    <section className="rounded-[32px] border border-sky-100 bg-white/90 p-7 shadow-sm sm:p-9"><p className="text-sm font-black tracking-[0.2em] text-brand-700">EasMusic CMS</p><h1 className="mt-2 text-4xl font-black text-brand-950">音乐内容管理</h1><p className="mt-4 max-w-3xl text-sm font-bold leading-7 text-slate-600">所有音乐资料通过后台维护。封面自动转换为 WebP 后存入 Supabase Storage。</p></section>
    <section className="grid gap-4 sm:grid-cols-2">{modules.map(([href, title, description]) => <Link key={href} href={href} className="rounded-[26px] border border-sky-100 bg-white/88 p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><h2 className="text-2xl font-black text-brand-950">{title}</h2><p className="mt-3 text-sm font-bold leading-7 text-slate-500">{description}</p><span className="mt-5 inline-flex text-sm font-black text-brand-700">进入管理 →</span></Link>)}</section>
  </main></>
}
