'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { publicImageVariantUrl } from '@/lib/image-variants'

export type DraftBoxItem = Readonly<{
  id: string
  title: string
  summary: string
  boardName: string
  updatedAt: string
  updatedAtLabel: string
  imageCount: number
  imageUrl: string | null
  version: number
}>

export function DraftBox({ initialDraft }: Readonly<{ initialDraft: DraftBoxItem | null }>) {
  const router = useRouter()
  const [draft, setDraft] = useState<DraftBoxItem | null>(initialDraft)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function deleteDraft() {
    if (!draft || deleting) return
    setDeleting(true)
    setError('')
    try {
      const response = await fetch('/api/posts/draft', { method: 'DELETE' })
      const data = await response.json().catch(() => ({})) as { message?: unknown }
      if (!response.ok) {
        setError(typeof data.message === 'string' ? data.message : '草稿删除失败，请稍后重试')
        return
      }
      setDraft(null)
      setDeleteOpen(false)
      router.refresh()
    } catch {
      setError('网络连接失败，请稍后重试')
    } finally {
      setDeleting(false)
    }
  }

  if (!draft) {
    return (
      <section className="border border-sky-100 bg-white/85 p-8 text-center shadow-sm sm:p-12">
        <p className="text-4xl" aria-hidden="true">✎</p>
        <h2 className="mt-4 text-xl font-black text-brand-950">还没有未发布的草稿</h2>
        <p className="mt-2 text-sm font-bold leading-7 text-slate-500">开始写一篇帖子，编辑器会自动把内容同步到你的账号。</p>
        <Link href="/posts/new?returnTo=%2Fdrafts" className="mt-6 inline-flex min-h-11 items-center rounded-sm bg-brand-700 px-5 text-sm font-black text-white transition hover:opacity-90">
          开始发布
        </Link>
      </section>
    )
  }

  const imageUrl = draft.imageUrl ? publicImageVariantUrl(draft.imageUrl, 'thumb-md') || draft.imageUrl : null

  return (
    <>
      <section className="overflow-hidden border border-sky-100 bg-white/85 shadow-sm">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
          {imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={imageUrl} alt="草稿中的图片" className="h-28 w-full shrink-0 object-cover sm:h-28 sm:w-40" loading="lazy" />
          ) : (
            <div className="grid h-28 w-full shrink-0 place-items-center border border-dashed border-sky-100 bg-sky-50 text-3xl text-brand-300 sm:w-40" aria-hidden="true">✎</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">云端草稿</span>
              {draft.imageCount > 0 ? <span className="text-xs font-bold text-slate-500">图片 {draft.imageCount}</span> : null}
              <span className="text-xs font-bold text-slate-500">版本 {draft.version}</span>
            </div>
            <h2 className="mt-3 break-words text-xl font-black text-brand-950">{draft.title || '未命名草稿'}</h2>
            <p className="mt-2 line-clamp-3 break-words text-sm font-bold leading-7 text-slate-600">{draft.summary || '暂无正文摘要'}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-slate-500">
              <span>分区：{draft.boardName || '未选择'}</span>
              <time dateTime={draft.updatedAt}>最后编辑：{draft.updatedAtLabel}</time>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:justify-center">
            <Link href="/posts/new?returnTo=%2Fdrafts" className="inline-flex min-h-10 flex-1 items-center justify-center rounded-sm bg-brand-700 px-4 text-sm font-black text-white transition hover:opacity-90 sm:flex-none">
              继续编辑
            </Link>
            <button type="button" onClick={() => { setError(''); setDeleteOpen(true) }} className="inline-flex min-h-10 flex-1 items-center justify-center rounded-sm border border-red-200 px-4 text-sm font-black text-red-700 transition hover:bg-red-50 sm:flex-none">
              删除
            </button>
          </div>
        </div>
      </section>
      {error ? <p role="alert" className="mt-3 text-sm font-bold text-red-600">{error}</p> : null}
      <ConfirmDialog
        open={deleteOpen}
        title="确认删除这份草稿？"
        description="删除后不可恢复。"
        confirmLabel="确认删除"
        loading={deleting}
        onConfirm={() => void deleteDraft()}
        onCancel={() => {
          if (!deleting) setDeleteOpen(false)
        }}
      />
    </>
  )
}
