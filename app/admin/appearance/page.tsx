import { SiteHeader } from '@/components/SiteHeader'
import { requireAdminPage } from '@/components/AdminAccess'
import { getSiteAppearance } from '@/lib/site-config'
import { AppearanceForm } from './AppearanceForm'

export const dynamic = 'force-dynamic'

export default async function AdminAppearancePage() {
  const user = await requireAdminPage('/admin/appearance')

  const config = await getSiteAppearance()

  return (
    <>
      <SiteHeader user={user} config={config} />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <AppearanceForm initialConfig={config} />
      </main>
    </>
  )
}
