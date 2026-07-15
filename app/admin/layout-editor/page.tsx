import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { measureBootstrap } from '@/lib/bootstrap-timing'
import { isPageLayoutPageKey } from '@/lib/page-layout/registry'
import { getPageLayoutPreviewData } from '@/lib/page-layout/preview-data'
import { getAdminPageLayout, listPageLayoutRevisions } from '@/lib/page-layout/service'
import type { PageLayoutPreviewPayload } from '@/lib/page-layout/preview-data'
import type { SerializedPageLayoutRevision } from '@/lib/page-layout/types'
import { Suspense } from 'react'
import { LayoutEditorClient } from './LayoutEditorClient'

export const dynamic = 'force-dynamic'

function HeaderFallback() {
  return (
    <header className="sticky top-0 z-30 border-b border-sky-100/80 bg-white/88 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-4">
        <div className="text-lg font-black text-brand-950 sm:text-xl">私家E院</div>
        <div className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-slate-500">Header loading...</div>
      </div>
    </header>
  )
}

async function optionalBootstrap<T>(label: string, task: () => Promise<T>, fallback: T, timeoutMs = 1200): Promise<T> {
  const startedAt = Date.now()
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
    console.info(`[bootstrap] ${label} ${Date.now() - startedAt}ms`)
  }
}

export default async function LayoutEditorPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const [user, params] = await Promise.all([
    measureBootstrap('LayoutEditor.currentUser', requireAdminPage('/admin/layout-editor', 'layout.manage')),
    searchParams,
  ])
  const initialPage = isPageLayoutPageKey(params.page) ? params.page : 'home'
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
    <>
      <Suspense fallback={<HeaderFallback />}>
        <SiteHeader user={user} />
      </Suspense>
      <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-5">
        <LayoutEditorClient initialPage={initialPage} initialLayout={initialLayout} initialPreviewData={initialPreviewData} initialRevisions={initialRevisions} />
      </main>
    </>
  )
}
