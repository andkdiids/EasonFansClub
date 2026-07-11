import Link from 'next/link'
import { redirect } from 'next/navigation'
import { HomeHero } from '@/components/HomeHero'
import { HomeModules } from '@/components/HomeModules'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const config = await getSiteAppearance()

  return (
    <>
      <SiteHeader />
      <main
        className="space-y-20 px-5 py-8"
        style={{
          background: `linear-gradient(180deg, ${config.colors.background}, #ffffff 42%, #eff9ff)`,
          color: config.colors.text,
        }}
      >
        <div className="mx-auto max-w-7xl">
          <HomeHero slides={config.heroSlides} />
        </div>

        <section className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
          {[
            ['今日挂号', config.text.checkinCopy, '/checkin'],
            ['E院广场', config.text.forumCopy, '/boards/announcements'],
            ['EasMusic', config.text.musicCopy, '/music'],
          ].map(([title, copy, href]) => (
            <Link key={href} href={href} className="rounded-[30px] bg-white/78 p-8 shadow-xl shadow-sky-900/5 backdrop-blur transition hover:-translate-y-1">
              <h2 className="text-3xl font-black text-brand-950">{title}</h2>
              <p className="mt-4 min-h-16 text-lg font-bold leading-8 text-slate-600">{copy}</p>
              <span className="mt-8 inline-flex rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">打开</span>
            </Link>
          ))}
        </section>

        <HomeModules emptyText={config.text.emptyText} />

        <footer className="mx-auto max-w-6xl pb-10 text-center text-sm font-bold text-slate-500">
          {config.text.footerText}
        </footer>
      </main>
    </>
  )
}
