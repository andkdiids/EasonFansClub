import Link from 'next/link'
import { redirect } from 'next/navigation'
import { HomeHero } from '@/components/HomeHero'
import { HomeModules } from '@/components/HomeModules'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { defaultSiteAppearance, type SiteHeroSlide } from '@/lib/site-config'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const heroSlides: SiteHeroSlide[] = [
  {
    title: '听见 Eason，也听见自己。',
    subtitle: '今日挂号，记录此刻。',
    buttonText: '开始挂号',
    href: '/checkin',
    imageUrl: '',
    isVisible: true,
    sortOrder: 1,
  },
  {
    title: '在私家E院，和 E 友一起待会儿。',
    subtitle: '帖子、留言、音乐，慢慢说。',
    buttonText: '进入广场',
    href: '/boards/announcements',
    imageUrl: '',
    isVisible: true,
    sortOrder: 2,
  },
]

export default async function HomePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2F')

  return (
    <>
      <SiteHeader user={user} config={defaultSiteAppearance} />

      <main className="space-y-20 bg-gradient-to-b from-[#eef8ff] via-white to-[#eff9ff] px-5 py-8 text-[#102033]">
        <div className="mx-auto max-w-7xl">
          <HomeHero slides={heroSlides} />
        </div>

        <section className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
          {[
            ['今日挂号', '留下今天的心情。', '/checkin'],
            ['E院广场', '把一首歌聊成一段故事。', '/boards/announcements'],
            ['EasMusic', '一首歌，也是一段病历。', '/music'],
          ].map(([title, copy, href]) => (
            <Link key={href} href={href} className="rounded-[30px] bg-white/78 p-8 shadow-xl shadow-sky-900/5 backdrop-blur transition hover:-translate-y-1">
              <h2 className="text-3xl font-black text-brand-950">{title}</h2>
              <p className="mt-4 min-h-16 text-lg font-bold leading-8 text-slate-600">{copy}</p>
              <span className="mt-8 inline-flex rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">打开</span>
            </Link>
          ))}
        </section>

        <HomeModules emptyText="这里还安静，等你留下第一句话。" />

        <footer className="mx-auto max-w-6xl pb-10 text-center text-sm font-bold text-slate-500">
          Eason Chan Fans Club
        </footer>
      </main>
    </>
  )
}
