import type { Metadata } from 'next'
import { StudioBeadsTool } from '@/components/studio/StudioBeadsTool'
import { getSessionUserFromCookie } from '@/lib/auth'
import { buildPageMetadata } from '@/lib/share-metadata'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return buildPageMetadata({ title: '拼豆图纸 · 贝多芬与我', description: '把喜欢的画面，一颗一颗拼出来。', canonical: '/studio/beads' })
}

export default async function StudioBeadsPage() {
  const sessionUser = await getSessionUserFromCookie()
  return <StudioBeadsTool isAuthenticated={Boolean(sessionUser)} />
}
