'use client'

import { useServerClock } from '@/components/concerts/useServerClock'

export function ConcertCountdown({ target, label, serverNow }: Readonly<{ target: string | null; label: string; serverNow: string }>) {
  const now = useServerClock(serverNow)
  if (!target) return <p className="text-xs text-white/65">{label}：时间待确认</p>
  const distance = new Date(target).getTime() - now
  if (now === 0) return <p className="text-xs text-white/65">{label}：计算中…</p>
  if (distance <= 0) return <p className="text-xs text-white/65">{label}：已开始或结束</p>
  const totalSeconds = Math.floor(distance / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return <p className="text-sm font-semibold tabular-nums text-white/80">距离{label} <strong className="ml-2 text-xl text-white">{days.toString().padStart(2, '0')}天 {hours.toString().padStart(2, '0')}:{minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}</strong></p>
}
