import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { buildPageMetadata } from '@/lib/share-metadata'
import { getMySalonPosts } from '@/lib/salon'
import { SalonMine } from '@/components/salon/SalonMine'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return buildPageMetadata({ title: '我的投稿 · 沙龙', description: '查看你在沙龙提交的作品与审核状态。', canonical: '/salon/mine' })
}

export default async function SalonMinePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fsalon%2Fmine')
  const posts = await getMySalonPosts(user.id)
  return <main className="salon-page"><div className="salon-page-back"><Link href="/salon">← 返回沙龙</Link></div><header className="salon-header salon-mine-header"><div><p className="salon-kicker">MY SUBMISSIONS</p><h1>我的投稿</h1><p>审核中的作品不会出现在公开图库。</p></div><Link href="/salon/upload" className="salon-primary-button">上传照片</Link></header><SalonMine initialPosts={posts} /></main>
}
