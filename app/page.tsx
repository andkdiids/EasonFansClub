import { redirect } from 'next/navigation'
import { HomeLayoutSurface } from '@/components/HomeLayoutSurface'
import { SiteHeader } from '@/components/SiteHeader'
import { getSessionUserFromCookie } from '@/lib/auth'
import { getHomeAnnouncement } from '@/lib/home-announcement'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
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

  const [config, announcement, layoutConfig] = await Promise.all([
    getSiteAppearance(),
    getHomeAnnouncement(),
    getPublishedPageLayoutConfig('home'),
  ])
  const slides = config.heroSlides.some((item) => item.isVisible) ? config.heroSlides : fallbackHeroSlides(config)

  return (
    <>
      <SiteHeader user={user} config={config} />

      <main className="px-5 py-6 sm:py-8" style={{ background: config.colors.background, color: config.colors.text }}>
        <HomeLayoutSurface layoutConfig={layoutConfig} siteConfig={config} slides={slides} announcement={announcement} />
      </main>
    </>
  )
}
