import { redirect } from 'next/navigation'

export default function LegacyUpdatesPage() {
  redirect('/feedback?tab=updates')
}
