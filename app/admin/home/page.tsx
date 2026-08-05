import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { getSiteAppearance } from '@/lib/site-config'
import { HomeHeroManager } from './HomeHeroManager'

export const dynamic = 'force-dynamic'

export default async function AdminHomePage() {
  const user = await requireAdminPage('/admin/home', 'home_manage')
  const config = await getSiteAppearance()
  return <><SiteHeader user={user} config={config} /><main className="mx-auto max-w-6xl px-4 py-7 sm:px-5 sm:py-9"><HomeHeroManager initialSlides={config.heroSlides} /></main></>
}
