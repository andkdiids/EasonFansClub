import { redirect } from 'next/navigation'
import { HomeLayoutSurface } from '@/components/HomeLayoutSurface'
import { getCurrentUser } from '@/lib/auth'
import { getHomeAnnouncement } from '@/lib/home-announcement'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { getSiteAppearance, type SiteAppearanceConfig, type SiteHeroSlide } from '@/lib/site-config'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function fallbackSlides(config: SiteAppearanceConfig): SiteHeroSlide[] {
  return [{
    title: config.text.homeTitle,
    subtitle: config.text.homeSubtitle,
    buttonText: '浏览今日内容',
    href: '#community-content',
    imageUrl: config.images.checkinBackgroundUrl || config.images.loginBackgroundUrl,
    isVisible: true,
    sortOrder: 1,
  }]
}

export default async function CommunityPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fwelcome')

  const [config, announcement, layoutConfig] = await Promise.all([
    getSiteAppearance(),
    getHomeAnnouncement(),
    getPublishedPageLayoutConfig('home'),
  ])
  const slides = config.heroSlides.some((item) => item.isVisible) ? config.heroSlides : fallbackSlides(config)

  return <HomeLayoutSurface layoutConfig={layoutConfig} siteConfig={config} slides={slides} announcement={announcement} />
}
