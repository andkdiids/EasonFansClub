import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  redirect('/admin/security-settings')
}
