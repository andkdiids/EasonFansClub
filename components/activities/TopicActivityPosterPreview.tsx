'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { TopicActivityV2Test } from '@/lib/topic-activity-v2-config'
import { TOPIC_POSTER_QR, TOPIC_POSTER_QR_BRAND, topicPosterLayout } from '@/lib/topic-activity-v2-poster-layout'

/** Unsaved layout preview only. User preview/download/share still reuse one server PNG Blob. */
export function TopicActivityPosterPreview({ test }: Readonly<{ test: TopicActivityV2Test }>) {
  const [qr, setQr] = useState('')
  const [selectedResultId, setSelectedResultId] = useState('')
  const showQr = test.poster.showQrCode === true
  useEffect(() => {
    let active = true
    if (!showQr) return () => { active = false }
    void QRCode.toDataURL('https://ecfc.fans/activities/preview', { width: TOPIC_POSTER_QR.size - TOPIC_POSTER_QR_BRAND.padding * 2, margin: 4, errorCorrectionLevel: 'H' })
      .then((url) => { if (active) setQr(url) }).catch(() => { if (active) setQr('') })
    return () => { active = false }
  }, [showQr])
  const result = test.results.find((item) => item.id === selectedResultId)
    || test.results.find((item) => Boolean(item.imageUrl)) || test.results[0]
  const svg = topicPosterLayout({ testTitle: test.title, title: result?.title, description: result?.description, nickname: '示例昵称', poster: test.poster })
  const background = result?.imageUrl || test.poster.backgroundUrl
  const percent = (pixels: number) => `${pixels / TOPIC_POSTER_QR.size * 100}%`
  const centre = (size: number) => percent((TOPIC_POSTER_QR.size - size) / 2)
  return <section aria-label="结果海报布局预览" className="space-y-2">
    {test.results.length > 1 ? <label className="block text-sm">预览测试结果<select aria-label="预览测试结果" className="ml-2 max-w-full border border-[var(--border)] bg-[var(--surface)] p-2" value={result?.id || ''} onChange={(event) => setSelectedResultId(event.target.value)}>{test.results.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label> : null}
    <p className="text-xs text-[var(--foreground-muted)]">布局预览即时更新，使用示例昵称和示例二维码；最终结果的预览、下载与分享均使用同一张服务器 PNG。默认不显示昵称和二维码。</p>
    <div className="relative aspect-[9/16] w-full max-w-xs overflow-hidden" style={{ backgroundColor: background ? 'transparent' : '#102c48' }}>
      {/* Native images support existing public media and in-memory SVG previews. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {background ? <img src={background} alt="结果海报背景预览" className="absolute inset-0 h-full w-full object-cover" /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)} alt="结果海报布局预览" className="absolute inset-0 h-full w-full" />
      {showQr && qr ? <div className="absolute bg-white" style={{ left: `${TOPIC_POSTER_QR.left / 10.8}%`, top: `${TOPIC_POSTER_QR.top / 19.2}%`, width: `${TOPIC_POSTER_QR.size / 10.8}%`, aspectRatio: '1' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="活动二维码预览" className="absolute" style={{ left: percent(TOPIC_POSTER_QR_BRAND.padding), top: percent(TOPIC_POSTER_QR_BRAND.padding), width: percent(TOPIC_POSTER_QR.size - TOPIC_POSTER_QR_BRAND.padding * 2), height: percent(TOPIC_POSTER_QR.size - TOPIC_POSTER_QR_BRAND.padding * 2) }} />
        <span className="absolute bg-white" style={{ left: centre(TOPIC_POSTER_QR_BRAND.plateSize), top: centre(TOPIC_POSTER_QR_BRAND.plateSize), width: percent(TOPIC_POSTER_QR_BRAND.plateSize), height: percent(TOPIC_POSTER_QR_BRAND.plateSize), borderRadius: `${TOPIC_POSTER_QR_BRAND.radius / TOPIC_POSTER_QR_BRAND.plateSize * 100}%` }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-512.png" alt="ECFC 标志" className="absolute bg-white object-contain" style={{ left: centre(TOPIC_POSTER_QR_BRAND.logoSize), top: centre(TOPIC_POSTER_QR_BRAND.logoSize), width: percent(TOPIC_POSTER_QR_BRAND.logoSize), height: percent(TOPIC_POSTER_QR_BRAND.logoSize) }} />
      </div> : null}
    </div>
  </section>
}
