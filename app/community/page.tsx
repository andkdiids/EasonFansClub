import { redirect } from 'next/navigation'
import { HomeLayoutSurface } from '@/components/HomeLayoutSurface'
import { getCurrentUser } from '@/lib/auth'
import { getHomeAnnouncement } from '@/lib/home-announcement'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CommunityPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fwelcome')

  const [config, announcement, layoutConfig] = await Promise.all([
    getSiteAppearance(),
    getHomeAnnouncement(),
    getPublishedPageLayoutConfig('home'),
  ])
  return <HomeLayoutSurface layoutConfig={layoutConfig} siteConfig={config} slides={config.heroSlides} announcement={announcement} />
}
