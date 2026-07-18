import Link from 'next/link'
import { AdminSongCatalog } from '@/app/admin/music/AdminSongCatalog'
import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
export default async function AdminLivePage() { const user = await requireAdminPage('/admin/music/live', 'music_manage'); return <><SiteHeader user={user} /><main className="mx-auto max-w-6xl space-y-5 px-4 py-7 sm:px-5"><Link href="/admin/music" className="text-sm font-black text-brand-700">← EasMusic 管理</Link><AdminSongCatalog mode="live" /></main></> }
