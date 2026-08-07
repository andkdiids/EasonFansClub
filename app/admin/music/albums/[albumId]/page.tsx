import { AdminAlbumEditor } from '@/app/admin/music/albums/[albumId]/AdminAlbumEditor'
import { requireAdminPage } from '@/components/AdminAccess'

export default async function AdminAlbumDetailPage({ params }: { params: Promise<{ albumId: string }> }) { const { albumId } = await params; const user = await requireAdminPage(`/admin/music/albums/${albumId}`, 'music_manage'); return <><AdminAlbumEditor albumId={albumId} /></> }
