
import { requireAdminPage } from '@/components/AdminAccess'
import { getSiteAppearance } from '@/lib/site-config'
import { VisualManager } from './VisualManager'

export const dynamic = 'force-dynamic'

export default async function AdminVisualsPage() {
  const user = await requireAdminPage('/admin/visuals')
  const config = await getSiteAppearance()
  return <><main className="mx-auto max-w-7xl px-4 py-8 sm:px-5"><VisualManager initialConfig={config} /></main></>
}
