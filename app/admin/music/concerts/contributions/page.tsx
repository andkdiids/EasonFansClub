import { AdminConcertContributionManager } from '@/app/admin/music/concerts/contributions/AdminConcertContributionManager'
import { requireAdminPage } from '@/components/AdminAccess'
import Link from 'next/link'

export default async function AdminConcertContributionsPage({ searchParams }: { searchParams: Promise<{ submission?: string | string[] }> }) {
  await requireAdminPage('/admin/music/concerts/contributions', 'music_manage')
  const params = await searchParams
  const rawSubmission = Array.isArray(params.submission) ? params.submission[0] : params.submission
  const submissionId = typeof rawSubmission === 'string' && rawSubmission.trim() ? rawSubmission.trim() : null
  return <><div className="mx-auto max-w-7xl px-4 pt-6 sm:px-5"><Link href="/admin/review?type=concert" className="inline-flex bg-brand-950 px-4 py-2 text-sm font-black text-white">进入统一演唱会投稿审核</Link></div><AdminConcertContributionManager initialSubmissionId={submissionId} /></>
}
