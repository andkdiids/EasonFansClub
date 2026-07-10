import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '私家E院 | Eason Fans Club',
  description: '陈奕迅中文粉丝社区',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
