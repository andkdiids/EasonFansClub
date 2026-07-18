import { AdminAlbumEditor } from '@/app/admin/music/albums/[albumId]/AdminAlbumEditor'
import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'

export default async function AdminAlbumDetailPage({ params }: { params: Promise<{ albumId: string }> }) { const { albumId } = await params; const user = await requireAdminPage(`/admin/music/albums/${albumId}`, 'music_manage'); return <><SiteHeader user={user} /><AdminAlbumEditor albumId={albumId} /></> }
