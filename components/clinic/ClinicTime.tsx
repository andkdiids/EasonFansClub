'use client'

import { useEffect, useState } from 'react'

function formatClock(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function formatClinicTime(value: string, now = new Date()) {
  const date = new Date(value)
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000))
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`
  const today = formatDate(now)
  const day = formatDate(date)
  if (today === day) return formatClock(date)
  const yesterday = new Date(now.getTime() - 86_400_000)
  if (formatDate(yesterday) === day) return `昨天 ${formatClock(date)}`
  return day
}

export function ClinicTime({ value }: Readonly<{ value: string }>) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return <time dateTime={value} suppressHydrationWarning>{formatClinicTime(value, now)}</time>
}
