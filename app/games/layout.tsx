'use client'

import { usePathname } from 'next/navigation'

export default function GamesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isDailyPrescription = pathname === '/games/daily-prescription' || pathname.startsWith('/games/daily-prescription/')

  return <div className={isDailyPrescription ? 'daily-prescription-route-root' : 'games-route-root games-center-background games-full-width'}>{children}</div>
}
