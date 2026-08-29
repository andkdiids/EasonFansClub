import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { isPublicMetadataCrawlerUserAgent } from '@/lib/public-metadata-crawler'
import { buildPageMetadata, SITE_DESCRIPTION, SITE_TITLE } from '@/lib/share-metadata'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    canonical: '/',
  })
}

export default async function RootPage() {
  const requestHeaders = await headers()
  if (isPublicMetadataCrawlerUserAgent(requestHeaders.get('user-agent'))) {
    return (
      <main className="site-page-main mx-auto flex min-h-[60vh] w-full max-w-4xl items-center justify-center px-5 py-16 text-center">
        <section aria-labelledby="public-home-title" className="max-w-2xl rounded-3xl border border-sky-100 bg-white/90 p-8 shadow-sm sm:p-12">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-brand-700">Eason Fans Club</p>
          <h1 id="public-home-title" className="mt-4 text-4xl font-black tracking-tight text-brand-950">私家E院</h1>
          <p className="mt-4 text-base font-bold leading-8 text-slate-600">陈奕迅中文粉丝社区</p>
        </section>
      </main>
    )
  }

  const user = await getCurrentUser()
  redirect(user ? '/welcome' : '/login')
}
