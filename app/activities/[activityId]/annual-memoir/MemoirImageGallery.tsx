'use client'

import { useEffect, useRef, useState } from 'react'
import { memoirChapters } from '@/lib/annual-memoir-art'
import { useMemoirSwipe } from '@/lib/annual-memoir-swipe'

export function MemoirImageGallery({ files, close }: { files: File[]; close: () => void }) {
  const [index, setIndex] = useState(0)
  const [notice, setNotice] = useState('')
  const file = files[index]
  const [sources, setSources] = useState<string[]>([])
  const pending = useRef<AbortController | null>(null)
  useEffect(() => {
    const urls = files.map((image) => URL.createObjectURL(image))
    setSources(urls)
    return () => {
      pending.current?.abort()
      pending.current = null
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [files])
  const url = sources[index]
  const move = (direction: -1 | 1) => {
    const target = index + direction
    if (pending.current || !sources[target]) return
    const navigation = new AbortController()
    pending.current = navigation
    const image = new Image()
    image.src = sources[target]
    void image.decode().then(() => {
      if (navigation.signal.aborted) return
      setIndex(target)
      setNotice('')
    }).catch(() => {
      if (!navigation.signal.aborted) setNotice('图片暂时无法打开，请重试。')
    }).finally(() => {
      if (pending.current === navigation) pending.current = null
    })
  }
  const swipe = useMemoirSwipe(move)
  const canShare = typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })

  return <section aria-label="年度回忆图片" className="memoir-gallery">
    <header><button type="button" onClick={close}>‹ 返回画册</button><span>{index + 1} / {files.length}</span></header>
    <div className="memoir-gallery-image" {...swipe}>
      {/* A native image preserves the browser's image context menu. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt={memoirChapters[index]} width={1080} height={1920} draggable={false} />}
    </div>
    <footer>
      <p>长按图片，保存到相册</p>
      <div>
        <button disabled={index === 0} onClick={() => move(-1)}>上一张</button>
        {canShare && <button onClick={() => {
          void navigator.share({ files: [file] }).catch((error: unknown) => {
            if (!(error instanceof Error) || error.name !== 'AbortError') setNotice('可尝试长按图片保存。')
          })
        }}>打开系统分享</button>}
        <button disabled={index === files.length - 1} onClick={() => move(1)}>下一张</button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </footer>
  </section>
}
