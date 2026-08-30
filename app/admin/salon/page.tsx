import { requireAdminPage } from '@/components/AdminAccess'
import Link from 'next/link'
import { getSalonAdminPosts, getSalonOptions } from '@/lib/salon'
import { AdminSalonManager } from './AdminSalonManager'

export const dynamic = 'force-dynamic'

export default async function AdminSalonPage() {
  await requireAdminPage('/admin/salon', 'post_manage')
  const [initial, options] = await Promise.all([getSalonAdminPosts('PENDING', 1), getSalonOptions()])
  return <main className="salon-page admin-salon-page"><div className="salon-page-back"><Link href="/admin">← 返回后台</Link></div><header className="salon-header"><div><p className="salon-kicker">SALON MODERATION</p><h1>沙龙管理</h1><p>审核投稿、修正演唱会关联并处理违规作品。</p></div></header><AdminSalonManager initialPosts={initial.posts} initialHasMore={initial.hasMore} options={options} /></main>
}
