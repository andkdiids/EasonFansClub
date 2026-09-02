import type { Metadata } from 'next'
import { StudioProjects } from '@/components/studio/StudioProjects'
import { buildPageMetadata } from '@/lib/share-metadata'
import { getSessionUserFromCookie } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return buildPageMetadata({ title: '我的创作 · 贝多芬与我', description: '管理你的创作项目。', canonical: '/studio/my' })
}

export default async function StudioProjectsPage() {
  const sessionUser = await getSessionUserFromCookie()
  return <StudioProjects isAuthenticated={Boolean(sessionUser)} />
}
