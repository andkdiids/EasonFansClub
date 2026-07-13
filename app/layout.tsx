import type { Metadata } from 'next'
import { NotificationToast } from '@/components/NotificationToast'
import { getSessionUserFromCookie } from '@/lib/auth'
import './globals.css'

export const metadata: Metadata = {
  title: '私家E院 | Eason Fans Club',
  description: '陈奕迅中文粉丝社区',
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const sessionUser = await getSessionUserFromCookie()
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <NotificationToast enabled={Boolean(sessionUser)} />
      </body>
    </html>
  )
}
