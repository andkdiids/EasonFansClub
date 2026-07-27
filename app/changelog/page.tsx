import { redirect } from 'next/navigation'

export default function LegacyChangelogPage() {
  redirect('/feedback?tab=updates')
}
