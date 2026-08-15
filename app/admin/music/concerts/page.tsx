import Link from 'next/link'
import { AdminConcertManager } from '@/app/admin/music/concerts/AdminConcertManager'
import { requireAdminPage } from '@/components/AdminAccess'

export default async function AdminConcertsPage() {
  const user = await requireAdminPage('/admin/music/concerts', 'music_manage')
  return <><div className="mx-auto flex max-w-7xl justify-end px-4 pt-5 sm:px-5"><Link href="/admin/music/concerts/contributions" className="bg-amber-100 px-4 py-2 text-sm font-black text-amber-900">用户投稿审核</Link></div><AdminConcertManager /></>
}
