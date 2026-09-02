import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { HomeLayoutSurface } from '@/components/HomeLayoutSurface'
import { getCurrentUser } from '@/lib/auth'
import { getHomeAnnouncement } from '@/lib/home-announcement'
import { getSiteAppearance } from '@/lib/site-config'
import { buildPageMetadata, SITE_DESCRIPTION, SITE_TITLE } from '@/lib/share-metadata'
import { WECHAT_SHARE_IMAGE_PATH } from '@/lib/wechat-share-image'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    canonical: '/community',
    imageUrl: WECHAT_SHARE_IMAGE_PATH,
  })
}

export default async function CommunityPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fwelcome')

  const [config, announcement] = await Promise.all([
    getSiteAppearance({ cache: 'no-store' }),
    getHomeAnnouncement(),
  ])
  return <HomeLayoutSurface siteConfig={config} slides={config.heroSlides} announcement={announcement} />
}
