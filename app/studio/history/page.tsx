import type { Metadata } from 'next'
import { StudioHistory } from '@/components/studio/StudioHistory'
import { buildPageMetadata } from '@/lib/share-metadata'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return buildPageMetadata({ title: '最近使用 · 贝多芬与我', description: '回到最近打开的创作。', canonical: '/studio/history' })
}

export default function StudioHistoryPage() {
  return <StudioHistory />
}
