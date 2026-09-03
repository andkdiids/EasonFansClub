import type { Metadata } from 'next'
import { getCurrentUser } from '@/lib/auth'
import { getPharmacyPageData } from '@/lib/pharmacy'
import { AngelGiftClient } from '@/components/AngelGiftClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '天使的礼物 | 私家E院',
  description: '有些药，不写在处方上。',
}

export default async function AngelGiftPage() {
  const user = await getCurrentUser()
  const data = await getPharmacyPageData(user?.id || null)
  return <main className="angel-gift-page-shell"><AngelGiftClient initialData={data} /></main>
}

