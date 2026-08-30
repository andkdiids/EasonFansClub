import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { buildPageMetadata, SITE_DESCRIPTION, SITE_TITLE } from '@/lib/share-metadata'
import { WECHAT_SHARE_IMAGE_PATH } from '@/lib/wechat-share-image'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    canonical: '/',
    imageUrl: WECHAT_SHARE_IMAGE_PATH,
  })
}

export default async function RootPage() {
  const user = await getCurrentUser()
  redirect(user ? '/welcome' : '/login')
}
