'use client'

import { useEffect, useState } from 'react'

export function BeijingClock() {
  const [now, setNow] = useState('')

  useEffect(() => {
    function tick() {
      setNow(
        new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).format(new Date()),
      )
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [])

  return <span>{now || '北京时间加载中'}</span>
}
