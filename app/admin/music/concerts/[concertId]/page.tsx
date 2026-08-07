import { AdminConcertEditor } from '@/app/admin/music/concerts/[concertId]/AdminConcertEditor'
import { requireAdminPage } from '@/components/AdminAccess'

export default async function AdminConcertEditorPage({ params }: { params: Promise<{ concertId: string }> }) {
  const { concertId } = await params
  const user = await requireAdminPage(`/admin/music/concerts/${concertId}`, 'music_manage')
  return <><AdminConcertEditor concertId={concertId} /></>
}
