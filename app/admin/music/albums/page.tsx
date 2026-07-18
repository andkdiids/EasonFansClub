import { AdminAlbumManager } from '@/app/admin/music/albums/AdminAlbumManager'
import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'

export default async function AdminMusicAlbumsPage() { const user = await requireAdminPage('/admin/music/albums', 'music_manage'); return <><SiteHeader user={user} /><AdminAlbumManager /></> }
