import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { isPageLayoutPageKey } from '@/lib/page-layout/registry'
import { LayoutEditorClient } from './LayoutEditorClient'

export const dynamic = 'force-dynamic'

export default async function LayoutEditorPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireAdminPage('/admin/layout-editor', 'layout.manage')
  const params = await searchParams
  const initialPage = isPageLayoutPageKey(params.page) ? params.page : 'home'

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-5">
        <LayoutEditorClient initialPage={initialPage} />
      </main>
    </>
  )
}
