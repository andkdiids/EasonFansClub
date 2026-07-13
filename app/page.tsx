import Link from 'next/link'
import { redirect } from 'next/navigation'
import { HomeHero } from '@/components/HomeHero'
import { HomeModules } from '@/components/HomeModules'
import { HomeSystemAnnouncement } from '@/components/HomeSystemAnnouncement'
import { SiteHeader } from '@/components/SiteHeader'
import { getSessionUserFromCookie } from '@/lib/auth'
import { getHomeAnnouncement } from '@/lib/home-announcement'
import { getSiteAppearance, type SiteAppearanceConfig, type SiteHeroSlide } from '@/lib/site-config'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function fallbackHeroSlides(config: SiteAppearanceConfig): SiteHeroSlide[] {
  return [
    {
      title: config.text.homeTitle,
      subtitle: config.text.homeSubtitle,
      buttonText: config.text.homePrimaryButton,
      href: '/checkin',
      imageUrl: config.images.checkinBackgroundUrl,
      isVisible: true,
      sortOrder: 1,
    },
    {
      title: config.text.homeTitle,
      subtitle: config.text.forumCopy,
      buttonText: config.text.homeSecondaryButton,
      href: '/boards/announcements',
      imageUrl: config.images.logoUrl,
      isVisible: true,
      sortOrder: 2,
    },
  ]
}

export default async function HomePage() {
  console.log('[home:ssr] start')
  const user = await getSessionUserFromCookie()
  if (!user) redirect('/login?redirect=%2F')
  console.log('[home:ssr] auth session')

  const config = await getSiteAppearance()
  const announcement = await getHomeAnnouncement()
  const slides = config.heroSlides.some((item) => item.isVisible) ? config.heroSlides : fallbackHeroSlides(config)

  return (
    <>
      <SiteHeader user={user} config={config} />

      <main
        className="space-y-20 px-5 py-8"
        style={{ background: config.colors.background, color: config.colors.text }}
      >
        <div className="mx-auto max-w-7xl">
          <HomeHero slides={slides} siteName={config.text.siteName} buttonColor={config.colors.button} />
        </div>

        <HomeSystemAnnouncement announcement={announcement} />

        <section className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
          {[
            [config.text.homePrimaryButton, config.text.checkinCopy, '/checkin'],
            [config.text.homeSecondaryButton, config.text.forumCopy, '/boards/announcements'],
            ['EasMusic', config.text.musicCopy, '/music'],
          ].map(([title, copy, href]) => (
            <Link
              key={href}
              href={href}
              className="rounded-[30px] p-8 shadow-xl shadow-sky-900/5 backdrop-blur transition hover:-translate-y-1"
              style={{ backgroundColor: config.colors.card }}
            >
              <h2 className="text-3xl font-black text-brand-950">{title}</h2>
              <p className="mt-4 min-h-16 text-lg font-bold leading-8 text-slate-600">{copy}</p>
              <span
                className="mt-8 inline-flex rounded-full px-4 py-2 text-sm font-black"
                style={{ backgroundColor: config.colors.secondary, color: config.colors.link }}
              >
                打开
              </span>
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
