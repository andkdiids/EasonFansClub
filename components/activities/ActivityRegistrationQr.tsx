'use client'

import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'

export function ActivityRegistrationQr({ activityId, token }: Readonly<{ activityId: string; token: string }>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!canvasRef.current || !token) return
    const value = `${window.location.origin}/admin/activities/${encodeURIComponent(activityId)}/verify?token=${encodeURIComponent(token)}`
    QRCode.toCanvas(canvasRef.current, value, { width: 220, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0b1f35', light: '#ffffff' } })
      .then(() => setError(''))
      .catch(() => setError('二维码生成失败，请联系管理员手动核销'))
  }, [activityId, token])
  return <div className="flex flex-wrap items-center gap-4"><div className="grid min-h-56 min-w-56 place-items-center rounded-xl border border-[var(--border)] bg-white p-3">{error ? <p className="max-w-48 text-center text-xs font-bold text-rose-600">{error}</p> : <canvas ref={canvasRef} aria-label="活动报名核销二维码" />}</div><p className="max-w-xs text-xs font-bold leading-5 text-[var(--foreground-muted)]">到场时向工作人员展示此二维码。二维码只用于核验报名，不会直接完成其他操作。</p></div>
}
