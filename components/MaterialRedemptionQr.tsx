'use client'

import { useEffect, useRef, useState } from 'react'
import { drawBrandedQrToCanvas } from '@/lib/branded-qr-client'

export function MaterialRedemptionQr({ token }: { token: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!canvasRef.current || !token) return
    const verifyUrl = `${window.location.origin}/admin/material-redemptions/verify?token=${encodeURIComponent(token)}`
    drawBrandedQrToCanvas(canvasRef.current, verifyUrl, 240)
      .then(() => setError(''))
      .catch(() => setError('二维码生成失败，请使用兑换码核销'))
  }, [token])

  return (
    <div className="flex min-h-60 flex-col items-center justify-center border border-sky-100 bg-white p-4">
      {error ? <p className="text-center text-sm font-bold text-rose-600">{error}</p> : <canvas ref={canvasRef} aria-label="物料兑换核销二维码" />}
      <p className="mt-3 text-center text-xs font-bold text-slate-500">二维码只用于打开管理员确认页，不会直接完成核销。</p>
    </div>
  )
}
