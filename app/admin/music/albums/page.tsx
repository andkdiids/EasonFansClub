import { AdminAlbumManager } from '@/app/admin/music/albums/AdminAlbumManager'
import { requireAdminPage } from '@/components/AdminAccess'

export default async function AdminMusicAlbumsPage() { const user = await requireAdminPage('/admin/music/albums', 'music_manage'); return <><AdminAlbumManager /></> }
