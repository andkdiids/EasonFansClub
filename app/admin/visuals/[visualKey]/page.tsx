import { notFound } from 'next/navigation'
import { requireAdminPage } from '@/components/AdminAccess'
import { getSiteAppearance } from '@/lib/site-config'
import { pageVisualKeys, type PageVisualKey } from '@/lib/hero-visuals'
import { VisualManager } from '../VisualManager'

export const dynamic = 'force-dynamic'

export default async function AdminVisualSettingsPage({ params }: { params: Promise<{ visualKey: string }> }) {
  const { visualKey } = await params
  if (!pageVisualKeys.includes(visualKey as PageVisualKey)) notFound()
  await requireAdminPage(`/admin/visuals/${visualKey}`, 'site_config_manage')
  const config = await getSiteAppearance()
  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-5"><VisualManager initialConfig={config} visualKey={visualKey as PageVisualKey} /></main>
}
