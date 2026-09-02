'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ThemeToggle } from '@/components/ThemeToggle'
import { UiIcon } from '@/components/UiIcon'
import styles from './studio.module.css'

const items = [
  { href: '/studio', label: '首页' },
  { href: '/studio/gallery', label: '创作广场' },
  { href: '/studio/my', label: '我的创作' },
  { href: '/studio/history', label: '最近使用' },
]

export function StudioNav({ isAuthenticated }: Readonly<{ isAuthenticated: boolean }>) {
  const pathname = usePathname()
  return (
    <header className={styles.nav}>
      <div className={styles.navInner}>
        <Link href="/studio" className={styles.navBrand}>
          <span className={styles.navMark}><UiIcon name="palette" /></span>
          <span className={styles.navBrandCopy}>
            <strong>贝多芬与我</strong>
            <small className={styles.navBrandSub}>把喜欢的东西，做成自己的。</small>
          </span>
        </Link>
        <nav className={styles.navLinks} aria-label="创作平台导航">
          {items.map((item) => {
            const active = pathname === item.href || (item.href !== '/studio' && pathname.startsWith(`${item.href}/`))
            return <Link key={item.href} href={item.href} className={`${styles.navLink} ${active ? styles.navLinkActive : ''}`} aria-current={active ? 'page' : undefined}>{item.label}</Link>
          })}
        </nav>
        <div className={styles.navRight}>
          <ThemeToggle />
          <Link href={isAuthenticated ? '/community' : '/login?redirect=%2Fstudio'} className={styles.navBack}>{isAuthenticated ? '← 返回私家E院' : '登录'}</Link>
        </div>
      </div>
    </header>
  )
}
