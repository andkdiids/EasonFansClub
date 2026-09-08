import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/** Legacy review entry retained as a compatibility redirect. */
export default function AdminPostReviewPage() {
  redirect('/admin/review?type=post')
}
