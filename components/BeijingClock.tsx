'use client'

import { useEffect, useState } from 'react'
import { formatBeijingDateTime } from '@/lib/beijing-time'

export function BeijingClock() {
  const [now, setNow] = useState('')

  useEffect(() => {
    function tick() {
      setNow(formatBeijingDateTime())
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [])

  return <span>{now || '北京时间加载中'}</span>
}
