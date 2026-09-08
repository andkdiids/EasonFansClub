import { requireAdminPage } from '@/components/AdminAccess'
import Link from 'next/link'
import { getSalonAdminPosts, getSalonOptions } from '@/lib/salon'
import { AdminSalonManager } from './AdminSalonManager'

export const dynamic = 'force-dynamic'

export default async function AdminSalonPage({ searchParams }: { searchParams: Promise<{ postId?: string | string[] }> }) {
  await requireAdminPage('/admin/salon', 'post_manage')
  const params = await searchParams
  const rawPostId = Array.isArray(params.postId) ? params.postId[0] : params.postId
  const postId = typeof rawPostId === 'string' && rawPostId.trim() ? rawPostId.trim() : null
  const [initial, options] = await Promise.all([getSalonAdminPosts('PENDING', 1), getSalonOptions()])
  return <main className="salon-page admin-salon-page"><div className="salon-page-back"><Link href="/admin">← 返回后台</Link></div><header className="salon-header"><div><p className="salon-kicker">SALON MANAGEMENT</p><h1>沙龙管理</h1><p>审核入口已统一到审核中心；本页继续处理演唱会关联、分类和作品资料维护。</p><Link href="/admin/review?type=salon" className="mt-3 inline-flex bg-brand-950 px-4 py-2 text-sm font-black text-white">进入沙龙审核</Link></div></header><AdminSalonManager initialPosts={initial.posts} initialHasMore={initial.hasMore} initialPostId={postId} options={options} /></main>
}
