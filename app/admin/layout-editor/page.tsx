import { requireAdminPage } from '@/components/AdminAccess'

import { measureBootstrap } from '@/lib/bootstrap-timing'
import { isEditablePageLayoutPageKey, PAGE_LAYOUT_REGISTRY } from '@/lib/page-layout/registry'
import { getPageLayoutPreviewData } from '@/lib/page-layout/preview-data'
import { getAdminPageLayout, listPageLayoutRevisions } from '@/lib/page-layout/service'
import type { PageLayoutPreviewPayload } from '@/lib/page-layout/preview-data'
import type { SerializedPageLayoutRevision } from '@/lib/page-layout/types'
import { LayoutEditorClient } from './LayoutEditorClient'

export const dynamic = 'force-dynamic'

async function optionalBootstrap<T>(_label: string, task: () => Promise<T>, fallback: T, timeoutMs = 1200): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task(),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export default async function LayoutEditorPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const [user, params] = await Promise.all([
    measureBootstrap('LayoutEditor.currentUser', requireAdminPage('/admin/layout-editor', 'layout.manage')),
    searchParams,
  ])
  const initialPage = isEditablePageLayoutPageKey(params.page) ? params.page : PAGE_LAYOUT_REGISTRY[0].key
  const [initialLayout, initialPreviewData, initialRevisions] = await Promise.all([
    measureBootstrap('LayoutEditor.layout', getAdminPageLayout(initialPage)),
    optionalBootstrap<PageLayoutPreviewPayload | null>(
      'LayoutEditor.preview',
      () => getPageLayoutPreviewData(initialPage, user),
      null,
    ),
    optionalBootstrap<SerializedPageLayoutRevision[]>(
      'LayoutEditor.revisions',
      () => listPageLayoutRevisions(initialPage, 20),
      [],
    ),
  ])

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-5">
      <LayoutEditorClient initialPage={initialPage} initialLayout={initialLayout} initialPreviewData={initialPreviewData} initialRevisions={initialRevisions} />
    </main>
  )
}
