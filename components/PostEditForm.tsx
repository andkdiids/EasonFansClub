'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ContentImageUploader } from '@/components/ContentImageUploader'
import { MAX_CONTENT_IMAGES } from '@/lib/content-images'

export type ExistingMedia = { id: string; url: string; broken: boolean }

export function PostEditForm({
  postId,
  initialTitle,
  initialContent,
  initialMedia,
}: Readonly<{
  postId: string
  initialTitle: string
  initialContent: string
  initialMedia: ExistingMedia[]
}>) {
  const router = useRouter()
  const [title, setTitle] = useState(initialTitle)
  const [content, setContent] = useState(initialContent)
  const [media, setMedia] = useState(initialMedia.map((item) => ({ ...item, removed: false })))
  const [addImageUrls, setAddImageUrls] = useState<string[]>([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const keptCount = media.filter((item) => !item.removed).length
  const totalImages = keptCount + addImageUrls.length
  const canAddMore = totalImages < MAX_CONTENT_IMAGES

  function toggleRemove(id: string) {
    setMedia((prev) => prev.map((item) => (item.id === id ? { ...item, removed: !item.removed } : item)))
  }

  function removeAdded(index: number) {
    setAddImageUrls((prev) => prev.filter((_, i) => i !== index))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const keepMediaIds = media.filter((item) => !item.removed).map((item) => item.id)
      const response = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, keepMediaIds, addImageUrls }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.message || '保存失败，请稍后重试')
      }
      router.push(`/posts/${postId}`)
      router.refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-2xl border border-sky-100 bg-white/85 p-7 shadow-sm">
      <h1 className="text-2xl font-black text-brand-950">编辑帖子</h1>
      {error ? <p className="rounded-lg bg-red-50 px-4 py-3 text-sm font-black text-red-600">{error}</p> : null}

      <label className="block">
        <span className="text-sm font-black text-slate-700">标题</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="mt-2 w-full rounded-lg border border-sky-100 px-4 py-2"
          placeholder="请输入帖子标题"
        />
      </label>

      <label className="block">
        <span className="text-sm font-black text-slate-700">正文</span>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={12}
          className="mt-2 w-full rounded-lg border border-sky-100 px-4 py-2"
          placeholder="分享你的想法..."
        />
      </label>

      <section className="space-y-3">
        <span className="text-sm font-black text-slate-700">图片（{totalImages}/{MAX_CONTENT_IMAGES}）</span>

        {media.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {media.map((item) => (
              <div
                key={item.id}
                className={`relative overflow-hidden rounded-xl border ${
                  item.removed ? 'border-red-200 opacity-50' : 'border-sky-100'
                }`}
              >
                {item.broken ? (
                  <div className="flex h-28 items-center justify-center bg-slate-100 px-2 text-center text-xs font-bold text-slate-500">
                    图片已失效，建议删除后重新上传
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt="帖子图片" className="h-28 w-full object-cover" />
                )}
                <button
                  type="button"
                  onClick={() => toggleRemove(item.id)}
                  className={`absolute right-1 top-1 rounded-full px-2 py-1 text-xs font-black text-white ${
                    item.removed ? 'bg-emerald-600' : 'bg-slate-950/80'
                  }`}
                >
                  {item.removed ? '恢复' : '删除'}
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {addImageUrls.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {addImageUrls.map((url, index) => (
              <div key={url} className="relative overflow-hidden rounded-xl border border-brand-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="新上传图片" className="h-28 w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeAdded(index)}
                  className="absolute right-1 top-1 rounded-full bg-slate-950/80 px-2 py-1 text-xs font-black text-white"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {canAddMore ? (
          <ContentImageUploader value={addImageUrls} onChange={setAddImageUrls} />
        ) : (
          <p className="text-sm font-bold text-slate-500">已达到图片数量上限，删除部分图片后可继续上传。</p>
        )}
      </section>

      <div className="flex items-center justify-between gap-3 border-t border-sky-100 pt-5">
        <Link
          href={`/posts/${postId}`}
          className="rounded-lg border border-slate-200 px-5 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50"
        >
          取消
        </Link>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-brand-700 px-6 py-3 text-sm font-black text-white disabled:opacity-60"
        >
          {submitting ? '保存中...' : '保存修改'}
        </button>
      </div>
    </form>
  )
}
