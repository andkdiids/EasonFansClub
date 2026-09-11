import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getCurrentUser } from '@/lib/auth'
import { buildPageMetadata } from '@/lib/share-metadata'
import { getSalonOptions, getSalonPostForViewer } from '@/lib/salon'
import { SalonEditForm } from '@/components/salon/SalonEditForm'
import { normalizeSalonReturnTo } from '@/lib/salon-scroll-state'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return buildPageMetadata({ title: '编辑沙龙作品', description: '编辑你在沙龙发布的作品。', canonical: '/salon' })
}

export default async function SalonEditPage({ params, searchParams }: { params: Promise<{ postId: string }>; searchParams: Promise<{ from?: string; returnTo?: string }> }) {
  const [{ postId }, query] = await Promise.all([params, searchParams])
  const user = await getCurrentUser()
  if (!user) redirect(`/login?redirect=${encodeURIComponent(`/salon/${postId}/edit`)}`)
  const canModerate = await hasAdminPermission(user, 'post_manage').catch(() => false)
  const post = await getSalonPostForViewer(postId, user.id, canModerate)
  if (!post || (post.author.id !== user.id && !canModerate)) notFound()
  const returnHref = normalizeSalonReturnTo(query.from || query.returnTo)
  const detailHref = `/salon/${encodeURIComponent(postId)}${returnHref ? `?from=${encodeURIComponent(returnHref)}` : ''}`
  const options = await getSalonOptions()
  return <main className="salon-page salon-edit-page"><div className="salon-page-back"><Link href={detailHref}>← 返回当前作品</Link></div><header className="salon-header"><div><p className="salon-kicker">SALON EDITOR</p><h1>编辑沙龙作品</h1><p>作者编辑需要重新审核；有沙龙管理权限的管理员编辑后直接生效。</p></div></header><SalonEditForm post={post} options={options} detailHref={detailHref} /></main>
}
