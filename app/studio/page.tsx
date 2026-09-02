import type { Metadata } from 'next'
import { StudioHome } from '@/components/studio/StudioHome'
import { buildPageMetadata } from '@/lib/share-metadata'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return buildPageMetadata({ title: '贝多芬与我', description: '把喜欢的东西，做成自己的。', canonical: '/studio' })
}

export default function StudioPage() {
  return <StudioHome />
}
