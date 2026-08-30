import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { buildPageMetadata } from '@/lib/share-metadata'
import { getSalonOptions } from '@/lib/salon'
import { SalonUploadForm } from '@/components/salon/SalonUploadForm'
import { createSalonWatermarkText } from '@/lib/salon-watermark'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return buildPageMetadata({ title: '上传照片 · 沙龙', description: '把现场记录和高清壁纸分享进沙龙。', canonical: '/salon/upload' })
}

export default async function SalonUploadPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fsalon%2Fupload')
  const options = await getSalonOptions()
  return <main className="salon-page salon-upload-page"><div className="salon-page-back"><Link href="/salon">← 返回沙龙</Link></div><header className="salon-header salon-upload-header"><div><p className="salon-kicker">SALON SUBMISSION</p><h1>上传照片</h1><p>选择一次最多 9 张图片，作品会在审核通过后公开显示。</p></div></header><SalonUploadForm options={options} watermarkText={createSalonWatermarkText(user.uid, user.nickname)} /></main>
}
